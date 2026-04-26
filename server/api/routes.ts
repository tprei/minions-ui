import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import type {
  ApiResponse,
  ApiSession,
  CommandResult,
  CreateExternalTaskRequest,
  CreateSessionVariantsResult,
  ExternalTaskResult,
  MemoryEntry,
  MinionCommand,
  OverrideField,
  MergeReadiness,
  ResourceSnapshot,
  RestoreCheckpointResult,
  RuntimeConfigResponse,
  SessionCheckpoint,
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
import { advanceShip } from '../ship/coordinator'
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
import { getProvider } from '../session/providers/index'
import { buildMergeReadiness } from '../readiness/merge-readiness'
import {
  checkpointRowToApi,
  restoreSessionCheckpoint,
} from '../checkpoints/session-checkpoints'
import {
  buildExternalTaskMetadata,
  externalTaskRowToApi,
  insertExternalTask,
} from '../intake/external-tasks'
import {
  countPendingMemories,
  deleteMemory,
  getMemory,
  insertMemory,
  listMemories,
  searchMemories,
  updateMemory,
  type MemoryRow,
} from '../db/memories'
import { getEventBus } from '../events/bus'

const API_VERSION = '2.0.0'
const LIBRARY_VERSION = '0.1.0'
const FEATURES = [
  'sessions-create',
  'messages',
  'sessions-create-images',
  'transcript',
  'auth',
  'cors-allowlist',
  'dag',
  'ship-coordinator',
  'sessions-variants',
  'web-push',
  'screenshots',
  'diff',
  'pr-preview',
  'resource-metrics',
  'runtime-config',
  'merge-readiness',
  'session-checkpoints',
  'external-entrypoints',
  'memory',
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
  mode: z.enum(['task', 'plan', 'think', 'review', 'ship']),
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
  z.object({ action: z.literal('retry_rebase'), dagId: z.string(), nodeId: z.string() }),
  z.object({ action: z.literal('ship_advance'), sessionId: z.string(), to: z.enum(['think', 'plan', 'dag', 'verify', 'done']).optional() }),
])

const MessageSchema = z.object({
  text: z.string().min(1),
  sessionId: z.string().optional(),
  images: z.array(ImageSchema).optional(),
})

const ExternalTaskSchema = z.object({
  source: z.enum(['github_issue', 'github_pr_comment', 'linear_issue', 'slack_thread']),
  externalId: z.string().min(1),
  prompt: z.string().min(1),
  repo: z.string().min(1).optional(),
  mode: z.enum(['task', 'plan', 'think', 'review', 'ship']).default('task'),
  title: z.string().min(1).optional(),
  url: z.string().url().optional(),
  author: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
})

const CreateMemorySchema = z.object({
  repo: z.string().nullable().optional(),
  kind: z.enum(['user', 'feedback', 'project', 'reference']),
  title: z.string().min(1),
  body: z.string().min(1),
  sourceSessionId: z.string().optional(),
  sourceDagId: z.string().optional(),
  pinned: z.boolean().optional(),
})

const UpdateMemorySchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  kind: z.enum(['user', 'feedback', 'project', 'reference']).optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'superseded', 'pending_deletion']).optional(),
  pinned: z.boolean().optional(),
})

const ReviewMemorySchema = z.object({
  status: z.enum(['approved', 'rejected']),
})

const SLASH_MODES = new Map([
  ['task', 'task'],
  ['w', 'task'],
  ['plan', 'plan'],
  ['think', 'think'],
  ['review', 'review'],
  ['ship', 'ship'],
] as const)

type SlashMode = 'task' | 'plan' | 'think' | 'review' | 'ship'

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

function memoryRowToApi(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    repo: row.repo,
    kind: row.kind,
    title: row.title,
    body: row.body,
    status: row.status,
    sourceSessionId: row.source_session_id,
    sourceDagId: row.source_dag_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    supersededBy: row.superseded_by,
    reviewedAt: row.reviewed_at,
    pinned: row.pinned,
  }
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
      data: { apiVersion: API_VERSION, libraryVersion: LIBRARY_VERSION, features: FEATURES, provider: getProvider().name },
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
      const body: ApiResponse<ApiSession> = {
        data: session,
      }
      return c.json(body, 201)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.post('/api/entrypoints', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = ExternalTaskSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: formatZod(parsed.error.issues) }, 400)
    }

    const req = parsed.data satisfies CreateExternalTaskRequest
    const db = resolveDb()
    const existing = prepared.getExternalTaskByKey(db, req.source, req.externalId)
    if (existing) {
      const row = prepared.getSession(db, existing.session_id)
      if (!row) return c.json({ error: 'External task session not found' }, 409)
      return c.json({
        data: {
          task: externalTaskRowToApi(existing),
          session: sessionRowToApi(row),
          existing: true,
        } satisfies ExternalTaskResult,
      })
    }

    const repo = req.repo ?? process.env['DEFAULT_REPO']
    if (!repo) return c.json({ error: 'repo is required (or set DEFAULT_REPO on the engine)' }, 400)

    try {
      const { session } = await registry.create({
        mode: req.mode,
        prompt: req.prompt,
        repo,
        metadata: buildExternalTaskMetadata(req),
      })
      const task = insertExternalTask(db, req, session.id, repo)
      return c.json({ data: { task, session, existing: false } satisfies ExternalTaskResult }, 201)
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

    if (command.action === 'retry_rebase') {
      if (!scheduler?.retryNode) {
        return c.json({
          data: { success: false, error: 'no scheduler configured' },
        } satisfies ApiResponse<CommandResult>)
      }
      try {
        await scheduler.retryNode(command.nodeId, command.dagId)
        return c.json({ data: { success: true } } satisfies ApiResponse<CommandResult>)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ data: { success: false, error: message } } satisfies ApiResponse<CommandResult>)
      }
    }

    if (command.action === 'ship_advance') {
      if (!scheduler) {
        return c.json({
          data: { success: false, error: 'no scheduler configured' },
        } satisfies ApiResponse<CommandResult>)
      }
      try {
        const result = await advanceShip(command.sessionId, command.to, {
          db: resolveDb(),
          registry,
          scheduler,
        })
        return c.json({
          data: result.ok
            ? { success: true, ...(result.dagId ? { dagId: result.dagId } : {}) }
            : { success: false, error: result.reason ?? 'ship advance failed' },
        } satisfies ApiResponse<CommandResult>)
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
            const row = prepared.getSession(planCtx.db, sessionId)
            if (row?.mode === 'ship' && (row.stage ?? 'think') === 'plan' && !rest) {
              result = await advanceShip(sessionId, 'dag', planCtx)
            } else {
              result = await handleDag(rest, sessionId, planCtx)
            }
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
        if (!rest) {
          return c.json({ error: `/${command} requires a prompt` }, 400)
        }
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

  app.get('/api/sessions/:slug/readiness', async (c) => {
    const { slug } = c.req.param()
    const db = resolveDb()
    const row = findSessionRow(slug, db)
    if (!row) return c.json({ data: null, error: 'Session not found' }, 404)
    try {
      const readiness = await buildMergeReadiness({
        id: row.id,
        slug: row.slug,
        status: row.status,
        pr_url: row.pr_url,
        workspace_root: row.workspace_root,
        metadata: row.metadata,
      })
      return c.json({ data: readiness } satisfies ApiResponse<MergeReadiness>)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.get('/api/sessions/:slug/checkpoints', (c) => {
    const { slug } = c.req.param()
    const db = resolveDb()
    const row = findSessionRow(slug, db)
    if (!row) return c.json({ data: null, error: 'Session not found' }, 404)
    const checkpoints = prepared.listSessionCheckpoints(db, row.id).map(checkpointRowToApi)
    return c.json({ data: checkpoints } satisfies ApiResponse<SessionCheckpoint[]>)
  })

  app.post('/api/sessions/:slug/checkpoints/:checkpointId/restore', async (c) => {
    const { slug, checkpointId } = c.req.param()
    const db = resolveDb()
    const row = findSessionRow(slug, db)
    if (!row) return c.json({ data: null, error: 'Session not found' }, 404)
    if (!row.workspace_root) return c.json({ error: 'Session has no workspace' }, 422)
    if (row.status === 'running' || row.status === 'pending' || row.status === 'waiting_input' || registry.get(row.id)?.running) {
      return c.json({ error: 'Stop the session before restoring a checkpoint' }, 409)
    }

    try {
      const checkpoint = await restoreSessionCheckpoint({ db, session: row, checkpointId })
      const updated = prepared.getSession(db, row.id)
      const session = sessionRowToApi(updated ?? row)
      getEventBus().emit({ kind: 'session.snapshot', session })
      return c.json({ data: { checkpoint, session } satisfies RestoreCheckpointResult })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const status = message === 'Checkpoint not found' ? 404 : 500
      return c.json({ error: message }, status)
    }
  })

  const CreateVariantsSchema = z.object({
    prompt: z.string().min(1),
    mode: z.enum(['task', 'plan', 'think', 'review', 'ship']),
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

  app.get('/api/memories', (c) => {
    const db = resolveDb()
    const repo = c.req.query('repo')
    const status = c.req.query('status')
    const kind = c.req.query('kind')
    const q = c.req.query('q')

    let memories: MemoryRow[]
    if (q) {
      memories = searchMemories(db, q, {
        repo: repo ?? undefined,
        status: status as MemoryRow['status'] | undefined,
        kind: kind as MemoryRow['kind'] | undefined,
      })
    } else {
      memories = listMemories(db, {
        repo: repo ?? undefined,
        status: status as MemoryRow['status'] | undefined,
        kind: kind as MemoryRow['kind'] | undefined,
      })
    }

    const data = memories.map(memoryRowToApi)
    const pendingCount = countPendingMemories(db, repo ?? undefined)
    const body: ApiResponse<{ memories: MemoryEntry[]; pendingCount: number }> = {
      data: { memories: data, pendingCount },
    }
    return c.json(body)
  })

  app.post('/api/memories', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = CreateMemorySchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: formatZod(parsed.error.issues) }, 400)
    }
    const { repo, kind, title, body, sourceSessionId, sourceDagId, pinned } = parsed.data

    const db = resolveDb()
    const now = Date.now()

    try {
      const id = insertMemory(db, {
        repo: repo ?? null,
        kind,
        title,
        body,
        status: 'pending',
        source_session_id: sourceSessionId ?? null,
        source_dag_id: sourceDagId ?? null,
        created_at: now,
        updated_at: now,
        superseded_by: null,
        reviewed_at: null,
        pinned: pinned ?? false,
      })

      const memory = getMemory(db, id)
      if (!memory) {
        return c.json({ error: 'Failed to retrieve created memory' }, 500)
      }

      const apiMemory = memoryRowToApi(memory)
      getEventBus().emit({ kind: 'memory.proposed', memory: apiMemory })
      const response: ApiResponse<MemoryEntry> = { data: apiMemory }
      return c.json(response, 201)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.patch('/api/memories/:id', async (c) => {
    const { id } = c.req.param()
    const memoryId = parseInt(id, 10)
    if (!Number.isFinite(memoryId)) {
      return c.json({ error: 'Invalid memory ID' }, 400)
    }

    const raw = await c.req.json().catch(() => null)
    const parsed = UpdateMemorySchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: formatZod(parsed.error.issues) }, 400)
    }

    const db = resolveDb()
    const existing = getMemory(db, memoryId)
    if (!existing) {
      return c.json({ error: 'Memory not found' }, 404)
    }

    if (existing.status !== 'approved' && existing.status !== 'pending' && parsed.data.status === undefined) {
      return c.json({ error: 'Only approved or pending memories can be updated' }, 422)
    }

    const updates = parsed.data
    const now = Date.now()

    try {
      updateMemory(db, memoryId, {
        ...updates,
        updated_at: now,
      })

      const updated = getMemory(db, memoryId)
      if (!updated) {
        return c.json({ error: 'Failed to retrieve updated memory' }, 500)
      }

      const apiMemory = memoryRowToApi(updated)
      const response: ApiResponse<MemoryEntry> = { data: apiMemory }
      return c.json(response)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.patch('/api/memories/:id/review', async (c) => {
    const { id } = c.req.param()
    const memoryId = parseInt(id, 10)
    if (!Number.isFinite(memoryId)) {
      return c.json({ error: 'Invalid memory ID' }, 400)
    }

    const raw = await c.req.json().catch(() => null)
    const parsed = ReviewMemorySchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: formatZod(parsed.error.issues) }, 400)
    }

    const db = resolveDb()
    const existing = getMemory(db, memoryId)
    if (!existing) {
      return c.json({ error: 'Memory not found' }, 404)
    }

    if (existing.status === 'pending_deletion' && parsed.data.status === 'approved') {
      try {
        deleteMemory(db, memoryId)
        getEventBus().emit({ kind: 'memory.deleted', memoryId })
        const response: ApiResponse<{ deleted: true }> = { data: { deleted: true } }
        return c.json(response)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ error: message }, 500)
      }
    }

    const now = Date.now()

    try {
      updateMemory(db, memoryId, {
        status: parsed.data.status,
        reviewed_at: now,
        updated_at: now,
      })

      const updated = getMemory(db, memoryId)
      if (!updated) {
        return c.json({ error: 'Failed to retrieve reviewed memory' }, 500)
      }

      const apiMemory = memoryRowToApi(updated)
      getEventBus().emit({ kind: 'memory.reviewed', memory: apiMemory })
      const response: ApiResponse<MemoryEntry> = { data: apiMemory }
      return c.json(response)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.delete('/api/memories/:id', async (c) => {
    const { id } = c.req.param()
    const memoryId = parseInt(id, 10)
    if (!Number.isFinite(memoryId)) {
      return c.json({ error: 'Invalid memory ID' }, 400)
    }

    const db = resolveDb()
    const existing = getMemory(db, memoryId)
    if (!existing) {
      return c.json({ error: 'Memory not found' }, 404)
    }

    try {
      deleteMemory(db, memoryId)
      getEventBus().emit({ kind: 'memory.deleted', memoryId })
      const response: ApiResponse<{ deleted: true }> = { data: { deleted: true } }
      return c.json(response)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })
}
