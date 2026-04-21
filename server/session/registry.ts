import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ApiSession, CreateSessionMode, QuickAction } from '../../shared/api-types'
import { SessionRuntime, type StartOpts as RuntimeStartOpts, type SpawnFn } from './runtime'
import { prepareWorkspace, removeWorkspace, rebootstrapIfMissing } from '../workspace/prepare'
import type { WorkspaceHandle } from '../workspace/types'
import { buildMcpConfig, shouldAttachMcp } from '../mcp/config'
import { getDb, prepared, type SessionRow } from '../db/sqlite'
import { getEventBus } from '../events/bus'
import type { Database } from 'bun:sqlite'

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

function rowToApi(row: SessionRow): ApiSession {
  return {
    id: row.id,
    slug: row.slug,
    status: mapStatus(row.status),
    command: row.command,
    repo: row.repo ?? undefined,
    branch: row.branch ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    parentId: row.parent_id ?? undefined,
    childIds: [],
    needsAttention: row.needs_attention,
    attentionReasons: row.attention_reasons as ApiSession['attentionReasons'],
    quickActions: row.quick_actions as QuickAction[],
    mode: row.mode,
    conversation: [],
    transcriptUrl: `/api/sessions/${row.slug}/transcript`,
  }
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
    const row = prepared.getSession(db(), sessionId)
    if (row) bus.emit({ kind: 'session.snapshot', session: rowToApi(row) })
  }

  function wireCompletionHandler(sessionId: string): void {
    bus.onKind('session.completed', (e) => {
      if (e.sessionId !== sessionId) return
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
      metadata: {},
      pipeline_advancing: false,
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

    const finalRow = prepared.getSession(db(), sessionId)!
    return { session: rowToApi(finalRow), runtime }
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
    return prepared.listSessions(db()).map(rowToApi)
  }

  function snapshot(sessionId: string): ApiSession | undefined {
    const row = prepared.getSession(db(), sessionId)
    return row ? rowToApi(row) : undefined
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

    prepared.updateSession(db(), { id: sessionId, status: 'completed', updated_at: Date.now() })
    emitSnapshot(sessionId)
  }

  async function reply(
    sessionId: string,
    text: string,
    images?: Array<{ mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; dataBase64: string }>,
  ): Promise<boolean> {
    const runtime = runtimes.get(sessionId)
    if (!runtime) throw new Error(`No runtime for session ${sessionId}`)
    const ok = await runtime.injectInput(text, images)
    prepared.updateSession(db(), { id: sessionId, updated_at: Date.now() })
    return ok
  }

  async function reconcileOnBoot(): Promise<void> {
    const rows = db()
      .query<{ id: string; slug: string; status: string; claude_session_id: string | null; workspace_root: string | null; repo: string | null; branch: string | null; bare_dir: string | null; command: string; mode: string }, []>(
        "SELECT id, slug, status, claude_session_id, workspace_root, repo, branch, bare_dir, command, mode FROM sessions WHERE status IN ('running','waiting_input') ORDER BY updated_at",
      )
      .all()

    for (const row of rows) {
      const { id, slug, claude_session_id, workspace_root, repo, branch, bare_dir, command, mode } = row

      if (!claude_session_id) {
        prepared.updateSession(db(), { id, status: 'failed', updated_at: Date.now() })
        emitSnapshot(id)
        continue
      }

      if (!workspace_root || !bare_dir || !branch) {
        prepared.updateSession(db(), { id, status: 'failed', updated_at: Date.now() })
        emitSnapshot(id)
        continue
      }

      const cwd = path.join(workspace_root, slug)
      const handle: WorkspaceHandle = {
        slug,
        cwd,
        bareDir: bare_dir,
        branch,
        baseRef: branch.replace(/^minion\//, ''),
      }

      if (repo) {
        const repoName = extractRepoName(repo)
        await rebootstrapIfMissing(cwd, repoName, workspace_root)
      }

      const runtime = makeRuntime({
        sessionId: id,
        mode: mode as CreateSessionMode,
        cwd,
        initialPrompt: command,
        resumeClaudeSessionId: claude_session_id,
      })

      handles.set(id, handle)
      runtimes.set(id, runtime)
      wireCompletionHandler(id)

      void runtime.start()

      emitSnapshot(id)
    }
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
