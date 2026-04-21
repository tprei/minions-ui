import type { MiddlewareHandler } from 'hono'

export function bearerAuth(): MiddlewareHandler {
  return async (c, next) => {
    const expected = process.env['MINION_API_TOKEN']
    if (!expected) { await next(); return }
    const hdr = c.req.header('authorization')
    const fromHdr = hdr?.toLowerCase().startsWith('bearer ') ? hdr.slice(7).trim() : undefined
    const fromQuery = c.req.query('token')
    const got = fromHdr ?? fromQuery
    if (got !== expected) return c.json({ error: 'unauthorized' }, 401)
    await next()
  }
}
