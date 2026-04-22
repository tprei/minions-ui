import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { corsMiddleware } from './cors'

describe('corsMiddleware', () => {
  let app: Hono
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = process.env
    app = new Hono()
    app.use('*', corsMiddleware())
    app.get('/test', (c) => c.json({ ok: true }))
    app.post('/test', (c) => c.json({ ok: true }))
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('allows CORS when origin is in allowed list', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com'

    const res = await app.request('/test', {
      headers: { Origin: 'https://example.com' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
    expect(res.headers.get('Vary')).toBe('Origin')
  })

  it('does not set Allow-Origin when origin is not in list', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com'

    const res = await app.request('/test', {
      headers: { Origin: 'https://evil.com' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('handles multiple allowed origins', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://app1.com,https://app2.com,https://app3.com'

    const res1 = await app.request('/test', {
      headers: { Origin: 'https://app1.com' },
    })
    expect(res1.headers.get('Access-Control-Allow-Origin')).toBe('https://app1.com')

    const res2 = await app.request('/test', {
      headers: { Origin: 'https://app2.com' },
    })
    expect(res2.headers.get('Access-Control-Allow-Origin')).toBe('https://app2.com')

    const res3 = await app.request('/test', {
      headers: { Origin: 'https://app3.com' },
    })
    expect(res3.headers.get('Access-Control-Allow-Origin')).toBe('https://app3.com')
  })

  it('handles whitespace in allowed origins list', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = '  https://app1.com  ,  https://app2.com  '

    const res = await app.request('/test', {
      headers: { Origin: 'https://app1.com' },
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app1.com')
  })

  it('ignores empty strings in allowed origins list', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com,,,https://other.com'

    const res = await app.request('/test', {
      headers: { Origin: 'https://example.com' },
    })

    expect(res.status).toBe(200)
  })

  it('responds to OPTIONS preflight with 204', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com'

    const res = await app.request('/test', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS')
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type')
  })

  it('returns null body for OPTIONS preflight', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com'

    const res = await app.request('/test', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    })

    const body = await res.text()
    expect(body).toBe('')
  })

  it('sets Allow-Credentials header', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com'

    const res = await app.request('/test', {
      headers: { Origin: 'https://example.com' },
    })

    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  it('sets Allow-Methods header', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com'

    const res = await app.request('/test', {
      headers: { Origin: 'https://example.com' },
    })

    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS')
  })

  it('sets Allow-Headers header', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com'

    const res = await app.request('/test', {
      headers: { Origin: 'https://example.com' },
    })

    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type')
  })

  it('handles missing Origin header', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com'

    const res = await app.request('/test')

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS')
  })

  it('handles empty CORS_ALLOWED_ORIGINS environment variable', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = ''

    const res = await app.request('/test', {
      headers: { Origin: 'https://example.com' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('handles missing CORS_ALLOWED_ORIGINS environment variable', async () => {
    delete process.env['CORS_ALLOWED_ORIGINS']

    const res = await app.request('/test', {
      headers: { Origin: 'https://example.com' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('is case-sensitive for origin matching', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://Example.com'

    const res = await app.request('/test', {
      headers: { Origin: 'https://example.com' },
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('requires exact origin match including protocol', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com'

    const res = await app.request('/test', {
      headers: { Origin: 'http://example.com' },
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('requires exact origin match including port', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com:3000'

    const res = await app.request('/test', {
      headers: { Origin: 'https://example.com' },
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('allows localhost origins', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'http://localhost:5173'

    const res = await app.request('/test', {
      headers: { Origin: 'http://localhost:5173' },
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })

  it('supports Cloudflare Pages URLs', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://my-app.pages.dev'

    const res = await app.request('/test', {
      headers: { Origin: 'https://my-app.pages.dev' },
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://my-app.pages.dev')
  })

  it('handles complex multi-origin setup', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] =
      'http://localhost:5173,https://staging.example.com,https://prod.example.com'

    const res1 = await app.request('/test', {
      headers: { Origin: 'http://localhost:5173' },
    })
    expect(res1.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')

    const res2 = await app.request('/test', {
      headers: { Origin: 'https://staging.example.com' },
    })
    expect(res2.headers.get('Access-Control-Allow-Origin')).toBe('https://staging.example.com')

    const res3 = await app.request('/test', {
      headers: { Origin: 'https://prod.example.com' },
    })
    expect(res3.headers.get('Access-Control-Allow-Origin')).toBe('https://prod.example.com')

    const res4 = await app.request('/test', {
      headers: { Origin: 'https://attacker.com' },
    })
    expect(res4.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('sets Vary header when origin is allowed', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com'

    const res = await app.request('/test', {
      headers: { Origin: 'https://example.com' },
    })

    expect(res.headers.get('Vary')).toBe('Origin')
  })

  it('handles POST requests with CORS', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com'

    const res = await app.request('/test', {
      method: 'POST',
      headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'test' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
  })
})
