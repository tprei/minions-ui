import path from 'node:path'
import { Hono } from 'hono'
import { getDb, runMigrations } from './db/sqlite'
import { createSessionRegistry } from './session/registry'
import { corsMiddleware } from './api/cors'
import { registerApiRoutes } from './api/routes'
import { registerSseRoute } from './api/sse'
import { getEventBus } from './events/bus'
import { CompletionDispatcher } from './events/completion-dispatcher'
import type { HandlerCtx, ReplyQueue, ReplyQueueFactory } from './handlers/types'
import { statsHandler } from './handlers/stats-handler'
import { quotaHandler } from './handlers/quota-handler'
import { shipAdvanceHandler } from './handlers/ship-advance-handler'
import { modeCompletionHandler } from './handlers/mode-completion-handler'
import { loopCompletionHandler } from './handlers/loop-completion-handler'
import { taskCompletionHandler } from './handlers/task-completion-handler'
import { qualityGateHandler } from './handlers/quality-gate-handler'
import { digestHandler } from './handlers/digest-handler'
import { ciBabysitHandler } from './handlers/ci-babysit-handler'
import { parentNotifyHandler } from './handlers/parent-notify-handler'
import { restackResolverHandler } from './handlers/restack-resolver-handler'
import {
  createRealCIBabysitter,
  createRealQualityGates,
  createNoopProfileStore,
  createDefaultConfig,
} from './handlers/stubs'
import { createDagScheduler } from './dag/scheduler'
import { createLandingManager } from './dag/landing'
import { LoopScheduler } from './loops/scheduler'
import { DEFAULT_LOOPS } from './loops/definitions'
import { listLoops } from './loops/store'
import { ResourceMonitor } from './metrics/resource'
import { loadOverrides } from './config/runtime-overrides'
import { applyOverrides } from './config/apply'
import { createDigestBuilder } from './digest/digest'
import { ReplyQueue as DiskReplyQueue } from './session/reply-queue'
import { startPushNotifier } from './push/notifier'
import { startTokenProvider } from './github/token-provider'
import { installAskpass } from './github/askpass'
import { wirePrLifecycle } from './ci/pr-lifecycle'

const PORT = Number(process.env['PORT'] ?? 8080)
const WORKSPACE_ROOT = process.env['WORKSPACE_ROOT'] ?? '/tmp/minion-workspace'
const DEFAULT_REPO = process.env['DEFAULT_REPO'] ?? ''
const MAX_CONCURRENT_SESSIONS = Number(process.env['MAX_CONCURRENT_SESSIONS'] ?? 10)
const MAX_CONCURRENT_LOOPS = Number(process.env['MAX_CONCURRENT_LOOPS'] ?? 3)
const RESERVED_INTERACTIVE_SLOTS = Number(process.env['RESERVED_INTERACTIVE_SLOTS'] ?? 2)
const QUOTA_RETRY_MAX = Number(process.env['QUOTA_RETRY_MAX'] ?? 3)
const QUOTA_DEFAULT_SLEEP_MS = Number(process.env['QUOTA_DEFAULT_SLEEP_MS'] ?? 5 * 60 * 1000)
const DISK_PATH = process.env['METRICS_DISK_PATH'] ?? WORKSPACE_ROOT

const app = new Hono()
app.use('*', corsMiddleware())

const db = getDb()
runMigrations(db)

await startTokenProvider()
const askpass = installAskpass()
process.env['GIT_ASKPASS'] = askpass.envOverrides['GIT_ASKPASS']
process.env['SSH_ASKPASS'] = askpass.envOverrides['SSH_ASKPASS']

const registry = createSessionRegistry({ getDb: () => db })
const bus = getEventBus()

await registry.reconcileOnBoot()

const reconciledRows = db
  .query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM sessions WHERE status IN ('running','waiting_input')",
  )
  .get()

const reconciled = reconciledRows?.count ?? 0
console.log(`[minion] engine on :${PORT}, ${reconciled} sessions resumed`)

const ciBabysitter = createRealCIBabysitter(registry, db)
const scheduler = createDagScheduler({ registry, db, bus, workspace: WORKSPACE_ROOT, ciBabysitter })
await scheduler.reconcileOnBoot()

bus.onKind('session.resumed', (ev) => { void scheduler.onSessionResumed(ev.sessionId) })
bus.onKind('session.reply_injected', (ev) => { void scheduler.onSessionResumed(ev.sessionId) })

const loopScheduler = new LoopScheduler({
  db,
  registry,
  workspaceRoot: WORKSPACE_ROOT,
  repo: DEFAULT_REPO,
  maxConcurrentSessions: MAX_CONCURRENT_SESSIONS,
  getInteractiveSessionCount: () =>
    registry.list().filter((s) => s.mode !== 'loop').length,
})

const replyQueueFactory: ReplyQueueFactory = {
  forSession: (sessionId: string): ReplyQueue => {
    const cwd = path.join(WORKSPACE_ROOT, sessionId)
    const disk = new DiskReplyQueue(sessionId, cwd)
    return {
      async pending(): Promise<string[]> {
        return disk.pending().map((q) => q.text)
      },
      async drain(): Promise<string[]> {
        const items = disk.pending()
        for (const item of items) disk.markDelivered(item.seq)
        return items.map((q) => q.text)
      },
    }
  },
}

const ctx: HandlerCtx = {
  db,
  registry,
  bus,
  scheduler,
  loopScheduler,
  ciBabysitter,
  qualityGates: createRealQualityGates(),
  digest: createDigestBuilder(),
  profileStore: createNoopProfileStore(),
  replyQueue: replyQueueFactory,
  config: createDefaultConfig(),
}

const dispatcher = new CompletionDispatcher(bus, ctx)
dispatcher.register(statsHandler)
dispatcher.register(quotaHandler)
dispatcher.register(shipAdvanceHandler)
dispatcher.register(modeCompletionHandler)
dispatcher.register(loopCompletionHandler)
dispatcher.register(taskCompletionHandler)
dispatcher.register(qualityGateHandler)
dispatcher.register(digestHandler)
dispatcher.register(restackResolverHandler)
dispatcher.register(ciBabysitHandler)
dispatcher.register(parentNotifyHandler)

wirePrLifecycle({
  bus,
  db,
  ciBabysitter: ctx.ciBabysitter,
  stopSession: (sessionId, reason) => ctx.registry.stop(sessionId, reason),
})

const loopsEnabled = (process.env['ENABLE_LOOPS'] ?? 'false').toLowerCase() === 'true'
if (loopsEnabled) {
  loopScheduler.start()
  console.log('[minion] loop scheduler started')
} else {
  console.log('[minion] loop scheduler disabled (set ENABLE_LOOPS=true to enable)')
}

const countsProvider = (): import('../shared/api-types').CountsSnapshot => {
  const sessions = registry.list()
  return {
    activeSessions: sessions.length,
    maxSessions: MAX_CONCURRENT_SESSIONS,
    activeLoops: sessions.filter((s) => s.mode === 'loop').length,
    maxLoops: MAX_CONCURRENT_LOOPS,
  }
}

const resourceMonitor = new ResourceMonitor(bus, {
  intervalMs: 2000,
  diskPath: DISK_PATH,
  countsProvider,
})
resourceMonitor.start()

// Re-apply persisted overrides at boot so interval / enabled flags survive restart.
try {
  applyOverrides(loadOverrides(), loopScheduler)
} catch (err) {
  console.warn('[minion] applyOverrides on boot failed:', err)
}

startPushNotifier(bus)

const landingManager = createLandingManager({
  bus,
  workspaceRoot: WORKSPACE_ROOT,
  registry,
  persistDag: (graph) => scheduler.persistDag(graph),
})
registerApiRoutes(app, registry, () => db, scheduler, landingManager, {
  loopRuntime: loopScheduler,
  resourceMonitor,
  getBaseConfig: () => {
    const rows = listLoops(db)
    const defaults = new Map(DEFAULT_LOOPS.map((l) => [l.id, l]))
    return {
      maxConcurrentSessions: MAX_CONCURRENT_SESSIONS,
      maxConcurrentLoops: MAX_CONCURRENT_LOOPS,
      reservedInteractiveSlots: RESERVED_INTERACTIVE_SLOTS,
      retryMax: QUOTA_RETRY_MAX,
      defaultSleepMs: QUOTA_DEFAULT_SLEEP_MS,
      mcp: {
        browserEnabled: process.env['ENABLE_BROWSER_MCP'] !== 'false',
        githubEnabled:
          process.env['ENABLE_GITHUB_MCP'] !== 'false' &&
          Boolean(process.env['GITHUB_TOKEN'] ?? process.env['GITHUB_PERSONAL_ACCESS_TOKEN']),
        context7Enabled: process.env['ENABLE_CONTEXT7_MCP'] !== 'false',
        supabaseEnabled:
          process.env['ENABLE_SUPABASE_MCP'] !== 'false' &&
          Boolean(process.env['SUPABASE_ACCESS_TOKEN']),
      },
      loops: rows.map((r) => ({
        id: r.id,
        enabled: r.enabled,
        intervalMs: r.interval_ms || (defaults.get(r.id)?.intervalMs ?? 60_000),
      })),
    }
  },
})
registerSseRoute(app, () => db)

export default { port: PORT, fetch: app.fetch, idleTimeout: 0 }
