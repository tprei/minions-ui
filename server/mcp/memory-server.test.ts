import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

interface BunServer {
  stop(): void
}

declare const Bun: {
  serve(options: {
    port: number
    fetch: (req: Request) => Response | Promise<Response>
  }): BunServer
}

describe('memory-server tool definitions', () => {
  test('memory-server.ts file exists and contains required tool names', () => {
    const serverPath = resolve(__dirname, 'memory-server.ts')
    const content = readFileSync(serverPath, 'utf-8')
    expect(content).toContain('remember')
    expect(content).toContain('recall')
    expect(content).toContain('supersede')
    expect(content).toContain('forget')
    expect(content).toContain('@modelcontextprotocol/sdk')
  })
})

describe('memory-server HTTP integration', () => {
  let server: BunServer
  const TEST_PORT = 18765

  beforeAll(() => {
    server = Bun.serve({
      port: TEST_PORT,
      fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === '/api/memories' && req.method === 'POST') {
          return Response.json({
            data: {
              id: 1,
              repo: 'test-repo',
              kind: 'user',
              title: 'Test Memory',
              body: 'Test body',
              status: 'pending',
              created_at: Date.now(),
              updated_at: Date.now(),
            },
          })
        }

        if (url.pathname.match(/^\/api\/memories\/\d+$/) && req.method === 'GET') {
          return Response.json({
            data: {
              id: 1,
              repo: 'test-repo',
              kind: 'user',
              title: 'Test Memory',
              body: 'Test body',
              status: 'approved',
              created_at: Date.now(),
              updated_at: Date.now(),
            },
          })
        }

        if (url.pathname === '/api/memories' && req.method === 'GET') {
          return Response.json({
            data: [
              {
                id: 1,
                repo: 'test-repo',
                kind: 'user',
                title: 'Test Memory',
                body: 'Test body',
                status: 'approved',
                created_at: Date.now(),
                updated_at: Date.now(),
              },
            ],
          })
        }

        if (url.pathname.match(/^\/api\/memories\/\d+\/supersede$/) && req.method === 'POST') {
          return Response.json({
            data: {
              old_id: 1,
              new_id: 2,
            },
          })
        }

        if (url.pathname.match(/^\/api\/memories\/\d+$/) && req.method === 'PATCH') {
          return Response.json({
            data: {
              id: 1,
              status: 'pending_deletion',
            },
          })
        }

        return new Response('Not Found', { status: 404 })
      },
    })
  })

  afterAll(() => {
    server.stop()
  })

  test('mock API server responds to POST /api/memories', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'test-repo',
        kind: 'user',
        title: 'Test',
        body: 'Test body',
      }),
    })
    expect(res.ok).toBe(true)
    const json = (await res.json()) as { data: { kind: string } }
    expect(json.data.kind).toBe('user')
  })

  test('mock API server responds to GET /api/memories/:id', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/memories/1`)
    expect(res.ok).toBe(true)
    const json = (await res.json()) as { data: { id: number } }
    expect(json.data.id).toBe(1)
  })

  test('mock API server responds to GET /api/memories', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/memories`)
    expect(res.ok).toBe(true)
    const json = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(json.data)).toBe(true)
  })
})
