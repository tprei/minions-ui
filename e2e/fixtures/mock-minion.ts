import * as http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiSession, ApiDagGraph, SseEvent, MinionCommand, VersionInfo } from '../../src/api/types'

export type { ApiSession, ApiDagGraph, SseEvent, MinionCommand, VersionInfo }

export interface MockMinion {
  url: string
  token: string
  emit(event: SseEvent): void
  setSessions(sessions: ApiSession[]): void
  setDags(dags: ApiDagGraph[]): void
  setVersion(v: Partial<VersionInfo>): void
  drop(): void
  lastCommands: MinionCommand[]
  lastMessages: Array<{ text: string; sessionId?: string }>
  close(): Promise<void>
}

function writeSse(res: ServerResponse, event: SseEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function cors(res: ServerResponse, allowedOrigin: string): void {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Max-Age', '600')
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export async function createMockMinion(opts?: {
  token?: string
  allowedOrigin?: string
}): Promise<MockMinion> {
  const token = opts?.token ?? ''
  const allowedOrigin = opts?.allowedOrigin ?? '*'

  let sessions: ApiSession[] = []
  let dags: ApiDagGraph[] = []
  let versionInfo: VersionInfo = {
    apiVersion: '1',
    libraryVersion: '1.0.0',
    features: [],
  }

  const lastCommands: MinionCommand[] = []
  const lastMessages: Array<{ text: string; sessionId?: string }> = []

  let activeSseRes: ServerResponse | null = null

  function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
    if (!token) return true
    const authHeader = req.headers['authorization']
    if (authHeader === `Bearer ${token}`) return true
    const urlObj = new URL(req.url ?? '/', `http://localhost`)
    if (urlObj.searchParams.get('token') === token) return true
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return false
  }

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url ?? '/', `http://localhost`)
    const path = urlObj.pathname

    if (req.method === 'OPTIONS') {
      cors(res, allowedOrigin)
      res.writeHead(204)
      res.end()
      return
    }

    cors(res, allowedOrigin)

    if (path === '/api/version' && req.method === 'GET') {
      if (!checkAuth(req, res)) return
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: versionInfo }))
      return
    }

    if (!checkAuth(req, res)) return

    if (path === '/api/sessions' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: sessions }))
      return
    }

    if (path === '/api/dags' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: dags }))
      return
    }

    if (path === '/api/events' && req.method === 'GET') {
      const origin = req.headers['origin'] ?? allowedOrigin
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'X-Accel-Buffering': 'no',
      })
      res.flushHeaders()
      res.write(': ping\n\n')
      activeSseRes = res
      req.on('close', () => {
        if (activeSseRes === res) activeSseRes = null
      })
      return
    }

    if (path === '/api/commands' && req.method === 'POST') {
      const body = await readBody(req)
      const cmd = JSON.parse(body) as MinionCommand
      lastCommands.push(cmd)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: { success: true } }))
      return
    }

    if (path === '/api/messages' && req.method === 'POST') {
      const body = await readBody(req)
      const payload = JSON.parse(body) as { text: string; sessionId?: string }
      if (!payload.text) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'text is required' }))
        return
      }
      lastMessages.push({ text: payload.text, sessionId: payload.sessionId })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: { ok: true, sessionId: payload.sessionId ?? null } }))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  })

  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve))

  const addr = server.address() as { port: number }
  const url = `http://localhost:${addr.port}`

  return {
    url,
    token,
    lastCommands,
    lastMessages,

    emit(event: SseEvent) {
      if (activeSseRes) writeSse(activeSseRes, event)
    },

    setSessions(s: ApiSession[]) {
      sessions = s
    },

    setDags(d: ApiDagGraph[]) {
      dags = d
    },

    setVersion(v: Partial<VersionInfo>) {
      versionInfo = { ...versionInfo, ...v }
    },

    drop() {
      if (activeSseRes) {
        activeSseRes.socket?.destroy()
        activeSseRes = null
      }
    },

    close(): Promise<void> {
      if (activeSseRes) {
        activeSseRes.socket?.destroy()
        activeSseRes = null
      }
      server.closeAllConnections()
      return new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      )
    },
  }
}
