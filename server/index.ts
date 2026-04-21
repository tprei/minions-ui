import { Hono } from 'hono'
import { getDb, runMigrations } from './db/sqlite'
import { createSessionRegistry } from './session/registry'
import { corsMiddleware } from './api/cors'
import { registerApiRoutes } from './api/routes'
import { registerSseRoute } from './api/sse'

const PORT = Number(process.env['PORT'] ?? 8080)

const app = new Hono()
app.use('*', corsMiddleware())

const db = getDb()
runMigrations(db)

const registry = createSessionRegistry({ getDb: () => db })

await registry.reconcileOnBoot()

const reconciledRows = db
  .query<{ count: number }, []>("SELECT COUNT(*) as count FROM sessions WHERE status IN ('running','waiting_input')")
  .get()

const reconciled = reconciledRows?.count ?? 0
console.log(`[minion] engine on :${PORT}, ${reconciled} sessions resumed`)

registerApiRoutes(app, registry, () => db)
registerSseRoute(app, () => db)

export default { port: PORT, fetch: app.fetch, idleTimeout: 0 }
