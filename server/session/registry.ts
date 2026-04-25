import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ApiSession, CreateSessionMode, QuickAction, TranscriptEvent } from '../../shared/api-types'
import { SessionRuntime, type StartOpts as RuntimeStartOpts, type SpawnFn } from './runtime'
import { prepareWorkspace, removeWorkspace, rebootstrapIfMissing } from '../workspace/prepare'
import type { WorkspaceHandle } from '../workspace/types'
import { buildMcpConfig, shouldAttachMcp } from '../mcp/config'
import { getDb, prepared, type SessionRow } from '../db/sqlite'
import { getEventBus } from '../events/bus'
import type { Database } from 'bun:sqlite'
import { injectAgentFiles } from './inject-assets'

const ADJECTIVES = ['brisk','wide','quiet','loud','smart','bright','dim','warm','cool','fast','slow','neat','crisp','rough','sharp','soft']
const NOUNS = ['ivy','oak','fern','river','meadow','peak','bay','cliff','dune','grove','lake','mesa','pond','reef','stream','wood']

function generateSlug(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!
  const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  return `${adj}-${noun}-${suffix}`
}

function extractRepoName(repoUrl: string): string {
  const segment = repoUrl.split('/').pop() ?? repoUrl
  return segment.replace(/\.git$/, '')
}

function mapStatus(status: SessionRow['status']): ApiSession['status'] {
  if (status === 'waiting_input') return 'running'
  return status
}

function rowToApi(row: SessionRow, db?: Database): ApiSession {
  const database = db ?? getDb()
  const childRows = database
    .query<{ id: string }, [string]>(
      'SELECT id FROM sessions WHERE parent_id = ? ORDER BY created_at ASC',
    )
    .all(row.id)
  const childIds = childRows.map((r) => r.id)

  const result: ApiSession = {
    id: row.id,
    slug: row.slug,
    status: mapStatus(row.status),
    command: row.command,
    repo: row.repo ?? undefined,
    branch: row.branch ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    parentId: row.parent_id ?? undefined,
    childIds,
    needsAttention: row.needs_attention,
    attentionReasons: row.attention_reasons as ApiSession['attentionReasons'],
    quickActions: row.quick_actions as QuickAction[],
    mode: row.mode,
    conversation: [],
    transcriptUrl: `/api/sessions/${row.slug}/transcript`,
  }

  if (row.mode === 'ship' && row.stage) {
    result.stage = row.stage as ApiSession['stage']
  }

  return result
}

export interface CreateSessionOpts {
  mode: CreateSessionMode
  prompt: string
  repo: string
  parentId?: string
  slug?: string
  workspaceRoot?: string
  startRef?: string
  initialImages?: Array<{ mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; dataBase64: string }>
  metadata?: Record<string, unknown>
}

export interface SessionRegistry {
  create(opts: CreateSessionOpts): Promise<{ session: ApiSession; runtime: SessionRuntime }>
  get(sessionId: string): SessionRuntime | undefined
  getBySlug(slug: string): SessionRuntime | undefined
  list(): ApiSession[]
  snapshot(sessionId: string): ApiSession | undefined
  stop(sessionId: string, reason?: string): Promise<void>
  close(sessionId: string): Promise<void>
  reply(sessionId: string, text: string, images?: Array<{ mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; dataBase64: string }>): Promise<boolean>
  reconcileOnBoot(): Promise<void>
  scheduleQuotaResume(sessionId: string, resetAt: number): Promise<void>
}

export interface RegistryOpts {
  getDb?: () => Database
  spawnFn?: SpawnFn
}

export function createSessionRegistry(opts: RegistryOpts = {}): SessionRegistry {
  const db = opts.getDb ?? getDb
  const bus = getEventBus()
  const runtimes = new Map<string, SessionRuntime>()
  const handles = new Map<string, WorkspaceHandle>()

  function makeRuntime(startOpts: RuntimeStartOpts): SessionRuntime {
    return new SessionRuntime({
      ...startOpts,
      spawnFn: opts.spawnFn,
      getDb: db,
    })
  }

  function emitSnapshot(sessionId: string): void {
    const database = db()
    const row = prepared.getSession(database, sessionId)
    if (row) bus.emit({ kind: 'session.snapshot', session: rowToApi(row, database) })
  }

  function wireCompletionHandler(sessionId: string): void {
    bus.onKind('session.completed', (e) => {
      if (e.sessionId !== sessionId) return
      runtimes.delete(sessionId)
      emitSnapshot(sessionId)
    })
  }

  async function create(createOpts: CreateSessionOpts): Promise<{ session: ApiSession; runtime: SessionRuntime }> {
    const sessionId = randomUUID()
    const slug = createOpts.slug ?? generateSlug()
    const workspaceRoot = createOpts.workspaceRoot ?? process.env['WORKSPACE_ROOT'] ?? './.minion-data'

    const handle = await prepareWorkspace({
      slug,
      repoUrl: createOpts.repo,
      workspaceRoot,
      startRef: createOpts.startRef,
    })
    injectAgentFiles(handle.cwd, undefined, workspaceRoot)

    const now = Date.now()
    const row: SessionRow = {
      id: sessionId,
      slug,
      status: 'pending',
      command: createOpts.prompt,
      mode: createOpts.mode,
      repo: createOpts.repo,
      branch: handle.branch,
      bare_dir: handle.bareDir,
      pr_url: null,
      parent_id: createOpts.parentId ?? null,
      variant_group_id: null,
      claude_session_id: null,
      workspace_root: workspaceRoot,
      created_at: now,
      updated_at: now,
      needs_attention: false,
      attention_reasons: [],
      quick_actions: [],
      conversation: [],
      quota_sleep_until: null,
      quota_retry_count: 0,
      metadata: createOpts.metadata ?? {},
      pipeline_advancing: false,
      stage: createOpts.mode === 'ship' ? 'think' : null,
      coordinator_children: [],
    }

    prepared.insertSession(db(), row)

    prepared.updateSession(db(), { id: sessionId, status: 'running', updated_at: Date.now() })
    emitSnapshot(sessionId)

    const mcp = buildMcpConfig({})
    const runtime = makeRuntime({
      sessionId,
      mode: createOpts.mode,
      cwd: handle.cwd,
      initialPrompt: createOpts.prompt,
      initialImages: createOpts.initialImages,
      mcpConfig: shouldAttachMcp(mcp) ? mcp : undefined,
    })

    handles.set(sessionId, handle)
    runtimes.set(sessionId, runtime)
    wireCompletionHandler(sessionId)

    void runtime.start()

    const database = db()
    const finalRow = prepared.getSession(database, sessionId)!
    return { session: rowToApi(finalRow, database), runtime }
  }

  function get(sessionId: string): SessionRuntime | undefined {
    return runtimes.get(sessionId)
  }

  function getBySlug(slug: string): SessionRuntime | undefined {
    for (const [id, runtime] of runtimes) {
      const row = prepared.getSession(db(), id)
      if (row?.slug === slug) return runtime
    }
    return undefined
  }

  function list(): ApiSession[] {
    const database = db()
    return prepared.listSessions(database).map((row) => rowToApi(row, database))
  }

  function snapshot(sessionId: string): ApiSession | undefined {
    const database = db()
    const row = prepared.getSession(database, sessionId)
    return row ? rowToApi(row, database) : undefined
  }

  async function stop(sessionId: string, reason?: string): Promise<void> {
    const runtime = runtimes.get(sessionId)
    if (!runtime) return
    await runtime.stop(reason)
  }

  async function close(sessionId: string): Promise<void> {
    const runtime = runtimes.get(sessionId)
    if (runtime?.running) {
      await runtime.stop()
    }

    runtimes.delete(sessionId)

    const handle = handles.get(sessionId)
    if (handle) {
      handles.delete(sessionId)
      await removeWorkspace(handle)
    }

    prepared.deleteSession(db(), sessionId)
    bus.emit({ kind: 'session.deleted', sessionId })
  }

  async function resumeRuntime(
    row: SessionRow,
    initialPrompt: string,
    initialImages?: Array<{ mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; dataBase64: string }>,
  ): Promise<SessionRuntime> {
    if (!row.claude_session_id) {
      throw new Error(`Session ${row.id} has no claude_session_id to resume from`)
    }
    if (!row.workspace_root || !row.bare_dir || !row.branch) {
      throw new Error(`Session ${row.id} is missing workspace metadata required to resume`)
    }

    const cwd = path.join(row.workspace_root, row.slug)
    const handle: WorkspaceHandle = {
      slug: row.slug,
      cwd,
      bareDir: row.bare_dir,
      branch: row.branch,
      baseRef: row.branch.replace(/^minion\//, ''),
    }

    if (row.repo) {
      const repoName = extractRepoName(row.repo)
      await rebootstrapIfMissing(cwd, repoName, row.workspace_root)
    }
    injectAgentFiles(cwd, undefined, row.workspace_root)

    const runtime = makeRuntime({
      sessionId: row.id,
      mode: row.mode as CreateSessionMode,
      cwd,
      initialPrompt,
      initialImages,
      resumeSessionId: row.claude_session_id,
    })

    handles.set(row.id, handle)
    runtimes.set(row.id, runtime)
    wireCompletionHandler(row.id)

    return runtime
  }

  async function reply(
    sessionId: string,
    text: string,
    images?: Array<{ mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; dataBase64: string }>,
  ): Promise<boolean> {
    let runtime = runtimes.get(sessionId)
    if (!runtime) {
      const row = prepared.getSession(db(), sessionId)
      if (!row) throw new Error(`Session ${sessionId} not found`)
      if (!row.claude_session_id) {
        throw new Error(`Session ${sessionId} has no claude_session_id to resume from`)
      }
      runtime = await resumeRuntime(row, text, images)
      void runtime.start()
      prepared.updateSession(db(), { id: sessionId, status: 'running', updated_at: Date.now() })
      bus.emit({ kind: 'session.resumed', sessionId, retryCount: 0 })
      emitSnapshot(sessionId)
      return true
    }
    const ok = await runtime.injectInput(text, images)
    prepared.updateSession(db(), { id: sessionId, updated_at: Date.now() })
    return ok
  }

  async function reconcileOnBoot(): Promise<void> {
    const rows = db()
      .query<{ id: string }, []>(
        "SELECT id FROM sessions WHERE status IN ('running','waiting_input') ORDER BY updated_at",
      )
      .all()

    for (const { id } of rows) {
      const row = prepared.getSession(db(), id)
      if (!row) continue

      if (row.claude_session_id) {
        try {
          const runtime = await resumeRuntime(row, row.command)
          prepared.updateSession(db(), { id, status: 'running', updated_at: Date.now() })
          emitSnapshot(id)
          void runtime.start()
          console.log('[session] reconcileOnBoot: resumed', id, 'mode', row.mode)
          continue
        } catch (err) {
          console.warn('[session] reconcileOnBoot: failed to resume', id, err)
        }
      }

      const now = Date.now()
      const seq = prepared.nextSeq(db(), id)
      const turn = currentTurn(id)

      const interrupted: TranscriptEvent = {
        seq,
        id: randomUUID(),
        sessionId: id,
        turn,
        timestamp: now,
        type: 'status',
        severity: 'error',
        kind: 'session_interrupted',
        message: 'Session was interrupted by an engine restart and could not be resumed. Start a new session to continue.',
      }
      prepared.insertEvent(db(), {
        session_id: id,
        seq,
        turn,
        type: 'status',
        timestamp: now,
        payload: { ...interrupted },
      })

      const closeSeq = seq + 1
      const closeEvt: TranscriptEvent = {
        seq: closeSeq,
        id: randomUUID(),
        sessionId: id,
        turn,
        timestamp: now,
        type: 'turn_completed',
        durationMs: 0,
        errored: true,
      }
      prepared.insertEvent(db(), {
        session_id: id,
        seq: closeSeq,
        turn,
        type: 'turn_completed',
        timestamp: now,
        payload: { ...closeEvt },
      })

      prepared.updateSession(db(), { id, status: 'failed', updated_at: now })
      bus.emit({ kind: 'session.stream', sessionId: id, event: interrupted })
      bus.emit({ kind: 'session.stream', sessionId: id, event: closeEvt })
      emitSnapshot(id)
    }
  }

  function currentTurn(sessionId: string): number {
    const row = db()
      .query<{ max_turn: number | null }, [string]>(
        'SELECT MAX(turn) as max_turn FROM session_events WHERE session_id = ?',
      )
      .get(sessionId)
    return row?.max_turn ?? 1
  }

  async function scheduleQuotaResume(sessionId: string, resetAt: number): Promise<void> {
    const delayMs = Math.max(0, resetAt - Date.now())
    setTimeout(() => {
      const runtime = runtimes.get(sessionId)
      if (!runtime) return
      bus.emit({ kind: 'session.resumed', sessionId, retryCount: 0 })
      void runtime.start()
    }, delayMs)
  }

  return { create, get, getBySlug, list, snapshot, stop, close, reply, reconcileOnBoot, scheduleQuotaResume }
}
