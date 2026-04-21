import type { MiddlewareHandler } from 'hono'

export function corsMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const allowedRaw = process.env['CORS_ALLOWED_ORIGINS'] ?? ''
    const allowedOrigins = allowedRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    const origin = c.req.header('origin')

    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    }

    if (origin !== undefined && allowedOrigins.includes(origin)) {
      corsHeaders['Access-Control-Allow-Origin'] = origin
      corsHeaders['Vary'] = 'Origin'
    }

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204, corsHeaders)
    }

    await next()

    for (const [k, v] of Object.entries(corsHeaders)) {
      c.res.headers.set(k, v)
    }
  }
}
