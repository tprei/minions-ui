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
import {
  createRealCIBabysitter,
  createRealQualityGates,
  createNoopProfileStore,
  createDefaultConfig,
} from './handlers/stubs'
import { createDagScheduler } from './dag/scheduler'
import { LoopScheduler } from './loops/scheduler'
import { ResourceMonitor } from './metrics/resource'
import { createDigestBuilder } from './digest/digest'
import { ReplyQueue as DiskReplyQueue } from './session/reply-queue'
import { startPushNotifier } from './push/notifier'
import { startTokenProvider } from './github/token-provider'
import { installAskpass } from './github/askpass'

const PORT = Number(process.env['PORT'] ?? 8080)
const WORKSPACE_ROOT = process.env['WORKSPACE_ROOT'] ?? '/tmp/minion-workspace'
const DEFAULT_REPO = process.env['DEFAULT_REPO'] ?? ''
const MAX_CONCURRENT_SESSIONS = Number(process.env['MAX_CONCURRENT_SESSIONS'] ?? 10)

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

const scheduler = createDagScheduler({ registry, db, bus, workspace: WORKSPACE_ROOT })

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
  ciBabysitter: createRealCIBabysitter(registry, db),
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
dispatcher.register(ciBabysitHandler)
dispatcher.register(parentNotifyHandler)

const loopsEnabled = (process.env['ENABLE_LOOPS'] ?? 'false').toLowerCase() === 'true'
if (loopsEnabled) {
  loopScheduler.start()
  console.log('[minion] loop scheduler started')
} else {
  console.log('[minion] loop scheduler disabled (set ENABLE_LOOPS=true to enable)')
}

const resourceMonitor = new ResourceMonitor(bus)
resourceMonitor.start()

startPushNotifier(bus)

registerApiRoutes(app, registry, () => db, scheduler)
registerSseRoute(app, () => db)

export default { port: PORT, fetch: app.fetch, idleTimeout: 0 }
