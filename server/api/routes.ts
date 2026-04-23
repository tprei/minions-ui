import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import type {
  ApiResponse,
  ApiSession,
  CommandResult,
  CreateSessionVariantsResult,
  MinionCommand,
  OverrideField,
  ResourceSnapshot,
  RuntimeConfigResponse,
  ScreenshotList,
  TranscriptSnapshot,
  VersionInfo,
} from '../../shared/api-types'
import type { SessionRegistry } from '../session/registry'
import { getDb, prepared } from '../db/sqlite'
import { bearerAuth } from './auth'
import { dagToApi, eventRowToTranscript, sessionRowToApi } from './wire-mappers'
import { fetchPrPreview } from '../github/pr-preview'
import { computeWorkspaceDiff } from '../workspace/diff'
import { handleExecute, handleSplit, handleStack, handleDag } from '../commands/plan-actions'
import type { PlanScheduler } from '../commands/plan-actions'
import { handleLandCommand } from '../commands/land'
import type { LandingManager } from '../dag/landing'
import { listDags } from '../dag/store'
import { topologicalSort, nodeIndex } from '../dag/dag'
import type { DagGraph } from '../dag/dag'
import { loadOverrides, saveOverrides } from '../config/runtime-overrides'
import { applyOverrides } from '../config/apply'
import type { LoopRuntime } from '../config/apply'
import type { ResourceMonitor } from '../metrics/resource'
import { RuntimeOverridesSchema } from '../config/schema'
import { DEFAULT_LOOPS } from '../loops/definitions'
import { createSessionVariants } from '../session/variants'
import { ensureVapidKeys } from '../push/vapid-keys'
import { subscribe, unsubscribe } from '../push/subscriptions'
import { handleReplyCommand } from '../commands/reply'
import { handleStatusCommand } from '../commands/status'
import { handleStatsCommand } from '../commands/stats'
import { handleUsageCommand } from '../commands/usage'
import { handleHelpCommand } from '../commands/help'
import { handleCleanCommand } from '../commands/clean'
import { handleConfigCommand } from '../commands/config'
import { handleLoopsCommand } from '../commands/loops'
import { handleDoneCommand } from '../commands/done'
import { handleDoctorCommand } from '../commands/doctor'

const API_VERSION = '2.0.0'
const LIBRARY_VERSION = '0.1.0'
const FEATURES = [
  'sessions-create',
  'messages',
  'images',
  'transcript',
  'auth',
  'cors-allowlist',
  'dag',
  'ship-pipeline',
  'variants',
  'push',
  'screenshots',
  'diff',
  'pr-preview',
  'resource-metrics',
  'runtime-config',
]

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024

const ImageSchema = z.object({
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  dataBase64: z.string().min(1),
})

function validateImagePayloads(
  images: Array<{ dataBase64: string }> | undefined,
): string | null {
  if (!images) return null
  let total = 0
  for (const img of images) {
    const bytes = Math.floor((img.dataBase64.length * 3) / 4)
    if (bytes > MAX_IMAGE_BYTES) {
      return `Image exceeds 5 MB limit (decoded ~${bytes} bytes)`
    }
    total += bytes
  }
  if (total > MAX_TOTAL_IMAGE_BYTES) {
    return `Total image payload exceeds 20 MB (decoded ~${total} bytes)`
  }
  return null
}

const CreateSessionSchema = z.object({
  prompt: z.string().min(1),
  mode: z.enum(['task', 'plan', 'think', 'review', 'ship-think']),
  repo: z.string().min(1).optional(),
  profileId: z.string().optional(),
  images: z.array(ImageSchema).optional(),
})

const CommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reply'), sessionId: z.string(), message: z.string() }),
  z.object({ action: z.literal('stop'), sessionId: z.string() }),
  z.object({ action: z.literal('close'), sessionId: z.string() }),
  z.object({ action: z.literal('plan_action'), sessionId: z.string(), planAction: z.enum(['execute', 'split', 'stack', 'dag']), markdown: z.string().optional() }),
  z.object({ action: z.literal('land'), dagId: z.string(), nodeId: z.string() }),
])

const MessageSchema = z.object({
  text: z.string().min(1),
  sessionId: z.string().optional(),
  images: z.array(ImageSchema).optional(),
})

const SLASH_MODES = new Map([
  ['task', 'task'],
  ['w', 'task'],
  ['plan', 'plan'],
  ['think', 'think'],
  ['review', 'review'],
  ['ship', 'ship-think'],
] as const)

type SlashMode = 'task' | 'plan' | 'think' | 'review' | 'ship-think'

function findSessionRow(key: string, db: Database) {
  const rows = prepared.listSessions(db)
  return rows.find((r) => r.slug === key || r.id === key)
}

function resolveSessionBySlug(slug: string, dbProvider: () => Database): ApiSession | null {
  const row = findSessionRow(slug, dbProvider())
  return row ? sessionRowToApi(row) : null
}

function findDagForSession(db: Database, sessionId: string): DagGraph | null {
  const graphs = listDags(db)
  for (const g of graphs) {
    if (g.rootSessionId === sessionId) return g
    if (g.nodes.some((n) => n.sessionId === sessionId)) return g
  }
  return null
}

function formatZod(issues: Array<{ path: Array<string | number>; message: string }>): string {
  return issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

export interface RuntimeBaseConfig {
  maxConcurrentSessions: number
  maxConcurrentLoops: number
  reservedInteractiveSlots: number
  retryMax: number
  defaultSleepMs: number
  mcp: {
    browserEnabled: boolean
    githubEnabled: boolean
    context7Enabled: boolean
    supabaseEnabled: boolean
  }
  loops: Array<{ id: string; enabled: boolean; intervalMs: number }>
}

export interface RuntimeContext {
  loopRuntime?: LoopRuntime
  resourceMonitor?: ResourceMonitor
  getBaseConfig?: () => RuntimeBaseConfig
}

export function registerApiRoutes(
  app: Hono,
  registry: SessionRegistry,
  dbProvider?: () => Database,
  scheduler?: PlanScheduler,
  landingManager?: LandingManager,
  runtimeCtx?: RuntimeContext,
): void {
  const resolveDb = dbProvider ?? getDb

  app.get('/api/version', (c) => {
    const body: ApiResponse<VersionInfo> = {
      data: { apiVersion: API_VERSION, libraryVersion: LIBRARY_VERSION, features: FEATURES },
    }
    return c.json(body)
  })

  app.get('/api/health', (c) => c.json({ data: { status: 'ok' } }))

  app.use('/api/*', bearerAuth())

  app.get('/api/sessions', (c) => {
    const sessions = registry.list()
    const body: ApiResponse<ApiSession[]> = { data: sessions }
    return c.json(body)
  })

  app.get('/api/sessions/:slug', (c) => {
    const { slug } = c.req.param()
    const session = resolveSessionBySlug(slug, resolveDb)
    if (!session) return c.json({ data: null, error: 'Session not found' }, 404)
    const body: ApiResponse<ApiSession> = { data: session }
    return c.json(body)
  })

  app.post('/api/sessions', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = CreateSessionSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: formatZod(parsed.error.issues) }, 400)
    }
    const { prompt, mode, repo, images } = parsed.data
    const imgErr = validateImagePayloads(images)
    if (imgErr) return c.json({ error: imgErr }, 400)
    const resolvedRepo = repo ?? process.env['DEFAULT_REPO']
    if (!resolvedRepo) {
      return c.json({ error: 'repo is required (or set DEFAULT_REPO on the engine)' }, 400)
    }
    try {
      const { session } = await registry.create({
        mode,
        prompt,
        repo: resolvedRepo,
        initialImages: images,
      })
      const body: ApiResponse<{ sessionId: string; slug: string }> = {
        data: { sessionId: session.id, slug: session.slug },
      }
      return c.json(body, 201)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.get('/api/sessions/:slug/transcript', (c) => {
    const { slug } = c.req.param()
    const afterParam = c.req.query('after')
    let afterSeq = -1
    if (afterParam !== undefined) {
      const n = Number(afterParam)
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < -1) {
        return c.json({ error: 'after must be an integer >= -1' }, 400)
      }
      afterSeq = n
    }

    const db = resolveDb()
    const row = findSessionRow(slug, db)
    if (!row) return c.json({ data: null, error: 'Session not found' }, 404)

    const eventRows = prepared.listEvents(db, row.id, afterSeq)
    const events = eventRows.map((er) =>
      eventRowToTranscript({
        session_id: er.session_id,
        seq: er.seq,
        turn: er.turn,
        type: er.type,
        timestamp: er.timestamp,
        payload: JSON.stringify(er.payload),
      }),
    )

    const highWaterMark = events.length > 0 ? (events[events.length - 1]?.seq ?? afterSeq) : afterSeq

    const snapshot: TranscriptSnapshot = {
      session: {
        sessionId: row.id,
        topicName: row.slug,
        repo: row.repo ?? undefined,
        mode: row.mode,
        startedAt: row.created_at,
        active: row.status === 'running' || row.status === 'pending',
        transcriptUrl: `/api/sessions/${row.slug}/transcript`,
      },
      events,
      highWaterMark,
    }
    const body: ApiResponse<TranscriptSnapshot> = { data: snapshot }
    return c.json(body)
  })

  app.post('/api/commands', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = CommandSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: formatZod(parsed.error.issues) }, 400)
    }
    const command = parsed.data as MinionCommand

    if (command.action === 'plan_action') {
      if (!scheduler) {
        const body: ApiResponse<CommandResult> = {
          data: { success: false, error: 'no scheduler configured' },
        }
        return c.json(body)
      }
      const planCtx = { db: resolveDb(), registry, scheduler }
      try {
        let result
        if (command.planAction === 'execute') {
          result = await handleExecute(command.sessionId, planCtx)
        } else if (command.planAction === 'split') {
          result = await handleSplit(command.sessionId, planCtx)
        } else if (command.planAction === 'stack') {
          result = await handleStack(command.sessionId, planCtx)
        } else {
          result = await handleDag(command.markdown ?? '', command.sessionId, planCtx)
        }
        const body: ApiResponse<CommandResult> = {
          data: result.ok
            ? { success: true, dagId: result.dagId }
            : { success: false, error: result.reason ?? 'plan_action failed' },
        }
        return c.json(body)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ data: { success: false, error: message } } satisfies ApiResponse<CommandResult>)
      }
    }

    if (command.action === 'land') {
      if (!landingManager) {
        return c.json({
          data: { success: false, error: 'landing is not configured on this engine' },
        } satisfies ApiResponse<CommandResult>)
      }
      try {
        const result = await handleLandCommand(command.nodeId, command.dagId, {
          landingManager,
          db: resolveDb(),
        })
        const body: ApiResponse<CommandResult> = {
          data: result.ok ? { success: true } : { success: false, error: result.error ?? 'land failed' },
        }
        return c.json(body)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ data: { success: false, error: message } } satisfies ApiResponse<CommandResult>)
      }
    }

    try {
      if (command.action === 'reply') {
        await registry.reply(command.sessionId, command.message)
      } else if (command.action === 'stop') {
        await registry.stop(command.sessionId)
      } else if (command.action === 'close') {
        await registry.close(command.sessionId)
      }
      const body: ApiResponse<CommandResult> = { data: { success: true } }
      return c.json(body)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ data: { success: false, error: message } } satisfies ApiResponse<CommandResult>)
    }
  })

  app.post('/api/messages', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = MessageSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: formatZod(parsed.error.issues) }, 400)
    }
    const { text, sessionId, images } = parsed.data

    if (images) {
      let totalBytes = 0
      for (const img of images) {
        const byteCount = Math.floor((img.dataBase64.length * 3) / 4)
        if (byteCount > MAX_IMAGE_BYTES) {
          return c.json({ error: `Image exceeds 5 MB limit (decoded ~${byteCount} bytes)` }, 400)
        }
        totalBytes += byteCount
      }
      if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
        return c.json({ error: `Total image payload exceeds 20 MB limit (decoded ~${totalBytes} bytes)` }, 400)
      }
    }

    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ')
      const command = spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx)
      const rest = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim()

      if (command === 'stop') {
        if (!sessionId) return c.json({ error: 'sessionId required for /stop' }, 400)
        await registry.stop(sessionId)
        return c.json({ data: { ok: true, sessionId } })
      }

      if (command === 'close') {
        if (!sessionId) return c.json({ error: 'sessionId required for /close' }, 400)
        await registry.close(sessionId)
        return c.json({ data: { ok: true, sessionId } })
      }

      if (command === 'execute' || command === 'split' || command === 'stack' || command === 'dag') {
        if (!sessionId) return c.json({ error: `sessionId required for /${command}` }, 400)
        if (!scheduler) return c.json({ error: 'no scheduler configured' }, 503)
        const planCtx = { db: resolveDb(), registry, scheduler }
        try {
          let result
          if (command === 'execute') {
            result = await handleExecute(sessionId, planCtx)
          } else if (command === 'split') {
            result = await handleSplit(sessionId, planCtx)
          } else if (command === 'stack') {
            result = await handleStack(sessionId, planCtx)
          } else {
            result = await handleDag(rest, sessionId, planCtx)
          }
          if (!result.ok) return c.json({ error: result.reason ?? `/${command} failed` }, 422)
          return c.json({ data: { ok: true, sessionId, dagId: result.dagId } })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return c.json({ error: message }, 500)
        }
      }

      if (command === 'reply' || command === 'r') {
        const result = await handleReplyCommand(rest, sessionId, { registry, db: resolveDb() })
        if (!result.ok) return c.json({ error: result.error ?? '/reply failed' }, 422)
        return c.json({ data: { ok: true, sessionId: result.sessionId } })
      }

      if (command === 'status') {
        const result = handleStatusCommand(sessionId, resolveDb())
        if (!result.ok) return c.json({ error: result.error ?? '/status failed' }, 422)
        return c.json({ data: result })
      }

      if (command === 'stats') {
        const days = rest ? parseInt(rest, 10) : 30
        const safeDays = Number.isFinite(days) && days > 0 ? days : 30
        const result = handleStatsCommand(safeDays, resolveDb())
        return c.json({ data: result })
      }

      if (command === 'usage') {
        const result = handleUsageCommand(resolveDb())
        return c.json({ data: result })
      }

      if (command === 'help') {
        const result = handleHelpCommand()
        return c.json({ data: result })
      }

      if (command === 'clean') {
        const result = handleCleanCommand(resolveDb())
        return c.json({ data: result })
      }

      if (command === 'config') {
        const result = handleConfigCommand(rest)
        if (!result.ok) return c.json({ error: result.error ?? '/config failed' }, 422)
        return c.json({ data: result })
      }

      if (command === 'loops') {
        const result = handleLoopsCommand(rest, resolveDb())
        if (!result.ok) return c.json({ error: result.error ?? '/loops failed' }, 422)
        return c.json({ data: result })
      }

      if (command === 'done') {
        const result = await handleDoneCommand(sessionId, { registry, db: resolveDb() })
        if (!result.ok) return c.json({ error: result.error ?? '/done failed' }, 422)
        return c.json({ data: { ok: true, sessionId: result.sessionId } })
      }

      if (command === 'doctor') {
        const result = await handleDoctorCommand()
        return c.json({ data: result })
      }

      if (command === 'land') {
        if (!sessionId) return c.json({ error: 'sessionId required for /land' }, 400)
        if (!landingManager) return c.json({ error: 'landing is not configured on this engine' }, 503)
        const db = resolveDb()
        const graph = findDagForSession(db, sessionId)
        if (!graph) return c.json({ error: 'no DAG associated with this session' }, 422)

        const idx = nodeIndex(graph)
        const order = topologicalSort(graph)
        const landable = order
          .map((id) => idx.get(id))
          .filter((n): n is NonNullable<typeof n> => !!n && n.status === 'done' && !!n.prUrl)

        if (landable.length === 0) {
          return c.json({ error: 'no nodes with a PR URL are ready to land' }, 422)
        }

        const landed: Array<{ nodeId: string; prUrl?: string }> = []
        const failed: Array<{ nodeId: string; error: string }> = []
        for (const node of landable) {
          const result = await landingManager.landNode(node.id, graph)
          if (result.ok) {
            landed.push({ nodeId: node.id, prUrl: result.prUrl })
          } else {
            failed.push({ nodeId: node.id, error: result.error ?? 'unknown error' })
            break
          }
        }

        return c.json({
          data: {
            ok: failed.length === 0,
            sessionId,
            dagId: graph.id,
            landed: landed.length,
            failed: failed.length,
            details: { landed, failed },
          },
        })
      }

      const modeEntry = SLASH_MODES.get(command as Parameters<typeof SLASH_MODES.get>[0])
      if (modeEntry !== undefined) {
        const defaultRepo = process.env['DEFAULT_REPO']
        if (!defaultRepo) {
          return c.json({ error: 'DEFAULT_REPO env is required for /command style messages' }, 400)
        }
        const mode = modeEntry as SlashMode
        try {
          const { session } = await registry.create({ mode, prompt: rest, repo: defaultRepo, initialImages: images })
          return c.json({ data: { ok: true, sessionId: session.id } })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return c.json({ error: message }, 500)
        }
      }

      return c.json({ error: 'unknown command' }, 400)
    }

    if (!sessionId) {
      return c.json({ error: 'sessionId required for plain text reply' }, 400)
    }
    try {
      await registry.reply(sessionId, text, images)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
    return c.json({ data: { ok: true, sessionId } })
  })

  app.delete('/api/sessions/:slug', async (c) => {
    const { slug } = c.req.param()
    const session = resolveSessionBySlug(slug, resolveDb)
    if (!session) return c.json({ data: null, error: 'Session not found' }, 404)
    await registry.close(session.id)
    return c.json({ data: { ok: true } })
  })

  app.get('/api/config/runtime', (c) => {
    const overrides = loadOverrides()
    const applied = applyOverrides(overrides)
    const base = runtimeCtx?.getBaseConfig?.() ?? null
    const fields: OverrideField[] = [
      {
        key: 'workspace.maxConcurrentSessions',
        label: 'Max concurrent sessions',
        type: 'number',
        category: 'concurrency',
        apply: 'live',
        integer: true,
        min: 1,
        max: 256,
        description: 'Total sessions the engine will run at once. Applied live to the scheduler.',
      },
      {
        key: 'loopsConfig.maxConcurrentLoops',
        label: 'Max concurrent loops',
        type: 'number',
        category: 'concurrency',
        apply: 'restart',
        integer: true,
        min: 1,
        max: 64,
        description: 'Upper bound on autonomous loop sessions running in parallel.',
      },
      {
        key: 'loopsConfig.reservedInteractiveSlots',
        label: 'Reserved interactive slots',
        type: 'number',
        category: 'concurrency',
        apply: 'restart',
        integer: true,
        min: 0,
        max: 64,
        description: 'Sessions held back from loops so interactive tasks can always start.',
      },
      {
        key: 'quota.retryMax',
        label: 'Quota retry max',
        type: 'number',
        category: 'concurrency',
        apply: 'restart',
        integer: true,
        min: 0,
        max: 32,
        description: 'How many times the engine will resume a session after a quota sleep.',
      },
      {
        key: 'quota.defaultSleepMs',
        label: 'Default quota sleep (ms)',
        type: 'number',
        category: 'concurrency',
        apply: 'restart',
        integer: true,
        min: 1000,
        description: 'Fallback sleep when an Anthropic quota error omits a reset time.',
      },
      {
        key: 'mcp.browserEnabled',
        label: 'Browser MCP (Playwright)',
        type: 'boolean',
        category: 'features',
        apply: 'restart',
      },
      {
        key: 'mcp.githubEnabled',
        label: 'GitHub MCP',
        type: 'boolean',
        category: 'features',
        apply: 'restart',
      },
      {
        key: 'mcp.context7Enabled',
        label: 'Context7 MCP',
        type: 'boolean',
        category: 'features',
        apply: 'restart',
      },
      {
        key: 'mcp.supabaseEnabled',
        label: 'Supabase MCP',
        type: 'boolean',
        category: 'features',
        apply: 'restart',
      },
    ]
    for (const l of DEFAULT_LOOPS) {
      fields.push(
        {
          key: `loops.${l.id}.enabled`,
          label: `${l.title} — enabled`,
          type: 'boolean',
          category: 'loops',
          apply: 'live',
        },
        {
          key: `loops.${l.id}.intervalMs`,
          label: `${l.title} — interval (ms)`,
          type: 'number',
          category: 'loops',
          apply: 'live',
          integer: true,
          min: 60_000,
          description: l.description,
        },
      )
    }
    const loopMeta = DEFAULT_LOOPS.map((l) => {
      const live = base?.loops.find((x) => x.id === l.id)
      return {
        id: l.id,
        name: l.title,
        defaultIntervalMs: live?.intervalMs ?? l.intervalMs,
        defaultEnabled: live?.enabled ?? true,
      }
    })
    const baseDoc: Record<string, unknown> = base
      ? {
          workspace: { maxConcurrentSessions: base.maxConcurrentSessions },
          loopsConfig: {
            maxConcurrentLoops: base.maxConcurrentLoops,
            reservedInteractiveSlots: base.reservedInteractiveSlots,
          },
          quota: { retryMax: base.retryMax, defaultSleepMs: base.defaultSleepMs },
          mcp: { ...base.mcp },
          loops: Object.fromEntries(
            base.loops.map((l) => [l.id, { enabled: l.enabled, intervalMs: l.intervalMs }]),
          ),
        }
      : {}
    const body: ApiResponse<RuntimeConfigResponse> = {
      data: {
        base: baseDoc,
        overrides,
        schema: { fields, loops: loopMeta },
        requiresRestart: applied.requiresRestart,
      },
    }
    return c.json(body)
  })

  app.patch('/api/config/runtime', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = RuntimeOverridesSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: formatZod(parsed.error.issues) }, 400)
    }
    const merged = saveOverrides(parsed.data)
    const applied = applyOverrides(merged, runtimeCtx?.loopRuntime)
    const body: ApiResponse<RuntimeConfigResponse> = {
      data: {
        base: {},
        overrides: merged,
        schema: { fields: [], loops: [] },
        requiresRestart: applied.requiresRestart,
      },
    }
    return c.json(body)
  })

  app.get('/api/sessions/:slug/diff', async (c) => {
    const { slug } = c.req.param()
    const db = resolveDb()
    const row = findSessionRow(slug, db)
    if (!row) return c.json({ data: null, error: 'Session not found' }, 404)
    if (!row.workspace_root) return c.json({ error: 'Session has no workspace' }, 422)
    const cwd = `${row.workspace_root}/${row.slug}`
    try {
      const result = await computeWorkspaceDiff(cwd, row.branch ?? undefined)
      return c.json({ data: result })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.get('/api/sessions/:slug/screenshots', (c) => {
    const { slug } = c.req.param()
    const db = resolveDb()
    const row = findSessionRow(slug, db)
    if (!row) return c.json({ data: null, error: 'Session not found' }, 404)
    const workspaceRoot = row.workspace_root ?? process.env['WORKSPACE_ROOT'] ?? './.minion-data'
    const screenshotDir = path.join(workspaceRoot, row.slug, '.screenshots')

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(screenshotDir, { withFileTypes: true })
    } catch {
      const body: ApiResponse<ScreenshotList> = {
        data: { sessionId: row.id, screenshots: [] },
      }
      return c.json(body)
    }

    const validExts = new Set(['.png', '.jpg', '.jpeg', '.webp'])
    const screenshots = entries
      .filter((e) => e.isFile() && validExts.has(path.extname(e.name).toLowerCase()))
      .map((e) => {
        const fullPath = path.join(screenshotDir, e.name)
        let size = 0
        try {
          size = fs.statSync(fullPath).size
        } catch {
          // non-fatal
        }
        return {
          file: e.name,
          url: `/api/sessions/${encodeURIComponent(row.slug)}/screenshots/${encodeURIComponent(e.name)}`,
          capturedAt: new Date().toISOString(),
          size,
        }
      })

    const body: ApiResponse<ScreenshotList> = {
      data: { sessionId: row.id, screenshots },
    }
    return c.json(body)
  })

  app.get('/api/sessions/:slug/screenshots/:filename', async (c) => {
    const { slug, filename } = c.req.param()
    const db = resolveDb()
    const row = findSessionRow(slug, db)
    if (!row) return c.json({ data: null, error: 'Session not found' }, 404)

    if (filename.includes('/') || filename.includes('..')) {
      return c.json({ error: 'Invalid filename' }, 400)
    }

    const workspaceRoot = row.workspace_root ?? process.env['WORKSPACE_ROOT'] ?? './.minion-data'
    const screenshotDir = path.join(workspaceRoot, row.slug, '.screenshots')

    let dirEntries: fs.Dirent[]
    try {
      dirEntries = fs.readdirSync(screenshotDir, { withFileTypes: true })
    } catch {
      return c.json({ error: 'Screenshots directory not found' }, 404)
    }

    const match = dirEntries.find((e) => e.isFile() && e.name === filename)
    if (!match) return c.json({ error: 'Screenshot not found' }, 404)

    const filePath = path.join(screenshotDir, filename)
    let data: Buffer
    try {
      data = fs.readFileSync(filePath)
    } catch {
      return c.json({ error: 'Could not read screenshot' }, 500)
    }

    const ext = path.extname(filename).toLowerCase()
    const contentType =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/png'

    return new Response(data, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' },
    })
  })

  app.get('/api/sessions/:slug/pr', async (c) => {
    const { slug } = c.req.param()
    const db = resolveDb()
    const row = findSessionRow(slug, db)
    if (!row) return c.json({ data: null, error: 'Session not found' }, 404)
    if (!row.pr_url) return c.json({ error: 'Session has no PR' }, 422)
    try {
      const preview = await fetchPrPreview(row.pr_url)
      return c.json({ data: preview })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  const CreateVariantsSchema = z.object({
    prompt: z.string().min(1),
    mode: z.enum(['task', 'plan', 'think', 'review', 'ship-think']),
    repo: z.string().min(1).optional(),
    profileId: z.string().optional(),
    count: z.number().int().min(2).max(10),
    images: z.array(ImageSchema).optional(),
  })

  app.post('/api/sessions/variants', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = CreateVariantsSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: formatZod(parsed.error.issues) }, 400)
    }
    const { prompt, mode, repo, count, images } = parsed.data
    const imgErr = validateImagePayloads(images)
    if (imgErr) return c.json({ error: imgErr }, 400)
    const resolvedRepo = repo ?? process.env['DEFAULT_REPO']
    if (!resolvedRepo) {
      return c.json({ error: 'repo is required (or set DEFAULT_REPO on the engine)' }, 400)
    }
    try {
      const result = await createSessionVariants(
        { prompt, mode, repo: resolvedRepo, count, initialImages: images },
        registry,
        resolveDb,
      )
      const body: ApiResponse<CreateSessionVariantsResult> = {
        data: { sessions: result.sessions },
      }
      return c.json(body, 201)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.get('/api/dags', (c) => {
    const db = resolveDb()
    const dagRows = prepared.listDags(db)
    const sessionMap = new Map(registry.list().map((s) => [s.id, s]))
    const data = dagRows.map((dag) => dagToApi(dag, prepared.listDagNodes(db, dag.id), sessionMap))
    return c.json({ data })
  })

  app.get('/api/dags/:id', (c) => {
    const db = resolveDb()
    const dag = prepared.getDag(db, c.req.param('id'))
    if (!dag) return c.json({ data: null, error: 'DAG not found' }, 404)
    const sessionMap = new Map(registry.list().map((s) => [s.id, s]))
    const data = dagToApi(dag, prepared.listDagNodes(db, dag.id), sessionMap)
    return c.json({ data })
  })

  app.get('/api/stats', (c) => {
    const db = resolveDb()
    const daysParam = c.req.query('days')
    const days = daysParam ? parseInt(daysParam, 10) : 30
    const safeDays = Number.isFinite(days) && days > 0 ? days : 30
    const now = Date.now()
    const periodStart = now - safeDays * 24 * 60 * 60 * 1000

    interface AggRow { mode: string; state: string; count: number; total_tokens: number | null }
    const rows = db
      .query<AggRow, [number]>(
        `SELECT mode, state, COUNT(*) as count, SUM(total_tokens) as total_tokens
         FROM session_stats WHERE recorded_at >= ? GROUP BY mode, state LIMIT 500`,
      )
      .all(periodStart)

    let totalSessions = 0
    let totalTokens = 0
    const bySessionState: Record<string, number> = {}
    const byMode: Record<string, number> = {}
    for (const row of rows) {
      totalSessions += row.count
      totalTokens += row.total_tokens ?? 0
      bySessionState[row.state] = (bySessionState[row.state] ?? 0) + row.count
      byMode[row.mode] = (byMode[row.mode] ?? 0) + row.count
    }

    return c.json({ data: { bySessionState, byMode, totalSessions, totalTokens, periodStart, periodEnd: now } })
  })

  app.get('/api/stats/modes', (c) => {
    const db = resolveDb()
    interface ModeRow { mode: string; count: number }
    const rows = db
      .query<ModeRow, []>(
        'SELECT mode, COUNT(*) as count FROM session_stats GROUP BY mode LIMIT 500',
      )
      .all()
    const byMode: Record<string, number> = {}
    for (const row of rows) {
      byMode[row.mode] = row.count
    }
    return c.json({ data: { byMode } })
  })

  app.get('/api/stats/recent', (c) => {
    const db = resolveDb()
    interface RecentRow { session_id: string; slug: string; repo: string | null; mode: string; state: string; duration_ms: number; total_tokens: number | null; recorded_at: number }
    const rows = db
      .query<RecentRow, []>(
        'SELECT session_id, slug, repo, mode, state, duration_ms, total_tokens, recorded_at FROM session_stats ORDER BY recorded_at DESC LIMIT 50',
      )
      .all()
    return c.json({ data: { sessions: rows } })
  })

  app.get('/api/metrics', (c) => {
    const monitor = runtimeCtx?.resourceMonitor
    if (monitor) {
      const snapshot: ResourceSnapshot = monitor.sample(Date.now())
      const body: ApiResponse<ResourceSnapshot> = { data: snapshot }
      return c.json(body)
    }
    const memUsage = process.memoryUsage()
    const snapshot: ResourceSnapshot = {
      ts: Date.now(),
      cpu: { usagePercent: 0, cpuCount: 1, source: 'host' },
      memory: {
        usedBytes: memUsage.rss,
        limitBytes: memUsage.rss,
        rssBytes: memUsage.rss,
        source: 'host',
      },
      disk: { path: '/', usedBytes: 0, totalBytes: 0 },
      eventLoopLagMs: 0,
      counts: { activeSessions: 0, maxSessions: 0, activeLoops: 0, maxLoops: 0 },
    }
    const body: ApiResponse<ResourceSnapshot> = { data: snapshot }
    return c.json(body)
  })

  app.get('/api/push/vapid-public-key', (c) => {
    try {
      const keys = ensureVapidKeys()
      return c.json({ data: { key: keys.publicKey } })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  const PushSubscribeSchema = z.object({
    endpoint: z.string().url(),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  })

  const PushUnsubscribeSchema = z.object({
    endpoint: z.string().url(),
  })

  app.post('/api/push-subscribe', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = PushSubscribeSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: formatZod(parsed.error.issues) }, 400)
    }
    try {
      const sub = subscribe(
        {
          endpoint: parsed.data.endpoint,
          expirationTime: parsed.data.expirationTime ?? null,
          keys: parsed.data.keys,
        },
        resolveDb,
      )
      return c.json({ data: { ok: true, id: sub.id } })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.delete('/api/push-subscribe', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = PushUnsubscribeSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: formatZod(parsed.error.issues) }, 400)
    }
    unsubscribe(parsed.data.endpoint, resolveDb)
    return c.json({ data: { ok: true } })
  })
}
