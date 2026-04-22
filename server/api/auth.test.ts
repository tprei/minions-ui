import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { bearerAuth } from './auth'

describe('bearerAuth', () => {
  let app: Hono
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = process.env
    app = new Hono()
    app.use('*', bearerAuth())
    app.get('/test', (c) => c.json({ ok: true }))
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('allows requests when MINION_API_TOKEN is not configured', async () => {
    delete process.env['MINION_API_TOKEN']

    const res = await app.request('/test')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('allows requests with valid Bearer token in header', async () => {
    process.env['MINION_API_TOKEN'] = 'secret-token-123'

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer secret-token-123' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('allows requests with valid token in query parameter', async () => {
    process.env['MINION_API_TOKEN'] = 'query-token-456'

    const res = await app.request('/test?token=query-token-456')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('rejects requests with invalid Bearer token', async () => {
    process.env['MINION_API_TOKEN'] = 'correct-token'

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer wrong-token' },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('rejects requests with invalid query token', async () => {
    process.env['MINION_API_TOKEN'] = 'correct-token'

    const res = await app.request('/test?token=wrong-token')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('rejects requests with missing token when configured', async () => {
    process.env['MINION_API_TOKEN'] = 'required-token'

    const res = await app.request('/test')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('handles case-insensitive Bearer prefix', async () => {
    process.env['MINION_API_TOKEN'] = 'case-test-token'

    const res = await app.request('/test', {
      headers: { Authorization: 'bearer case-test-token' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('handles Bearer prefix with mixed case', async () => {
    process.env['MINION_API_TOKEN'] = 'mixed-case-token'

    const res = await app.request('/test', {
      headers: { Authorization: 'BeArEr mixed-case-token' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('trims whitespace from Bearer token', async () => {
    process.env['MINION_API_TOKEN'] = 'trim-test'

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer   trim-test   ' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('prefers header token over query parameter', async () => {
    process.env['MINION_API_TOKEN'] = 'header-wins'

    const res = await app.request('/test?token=wrong-token', {
      headers: { Authorization: 'Bearer header-wins' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('rejects when header is invalid but query is valid', async () => {
    process.env['MINION_API_TOKEN'] = 'correct-token'

    const res = await app.request('/test?token=correct-token', {
      headers: { Authorization: 'Bearer wrong-token' },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('rejects Authorization header without Bearer prefix', async () => {
    process.env['MINION_API_TOKEN'] = 'no-prefix-token'

    const res = await app.request('/test', {
      headers: { Authorization: 'no-prefix-token' },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('rejects Basic auth when Bearer is required', async () => {
    process.env['MINION_API_TOKEN'] = 'bearer-only'

    const res = await app.request('/test', {
      headers: { Authorization: 'Basic YmVhcmVyLW9ubHk=' },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('handles empty Authorization header', async () => {
    process.env['MINION_API_TOKEN'] = 'required'

    const res = await app.request('/test', {
      headers: { Authorization: '' },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('handles Authorization header with only Bearer prefix', async () => {
    process.env['MINION_API_TOKEN'] = 'required'

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer' },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('handles empty token in environment variable', async () => {
    process.env['MINION_API_TOKEN'] = ''

    const res = await app.request('/test')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('validates token with special characters', async () => {
    process.env['MINION_API_TOKEN'] = 'token-with-!@#$%^&*()_+={}[]|:";\'<>,.?/~`'

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer token-with-!@#$%^&*()_+={}[]|:";\'<>,.?/~`' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
