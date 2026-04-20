import * as http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  ApiSession,
  ApiDagGraph,
  SseEvent,
  MinionCommand,
  VersionInfo,
  CreateSessionRequest,
  CreateSessionVariantsRequest,
  PrPreview,
  WireWorkspaceDiff,
  ScreenshotList,
  ScreenshotEntry,
  VapidPublicKey,
  PushSubscriptionJSON,
} from '../../src/api/types'

export type {
  ApiSession,
  ApiDagGraph,
  SseEvent,
  MinionCommand,
  VersionInfo,
  CreateSessionRequest,
  CreateSessionVariantsRequest,
  PrPreview,
  WireWorkspaceDiff,
  ScreenshotList,
  ScreenshotEntry,
  VapidPublicKey,
  PushSubscriptionJSON,
}

export interface MockMinion {
  url: string
  token: string
  emit(event: SseEvent): void
  setSessions(sessions: ApiSession[]): void
  setDags(dags: ApiDagGraph[]): void
  setVersion(v: Partial<VersionInfo>): void
  setPr(sessionId: string, pr: PrPreview | null): void
  setDiff(sessionId: string, diff: WireWorkspaceDiff | null): void
  setScreenshots(sessionId: string, screenshots: ScreenshotEntry[]): void
  setScreenshotBlob(file: string, body: Buffer, contentType?: string): void
  setVapidKey(key: string): void
  drop(): void
  lastCommands: MinionCommand[]
  lastMessages: Array<{ text: string; sessionId?: string }>
  lastCreateSessionRequests: CreateSessionRequest[]
  lastCreateVariantsRequests: CreateSessionVariantsRequest[]
  pushSubscriptions: PushSubscriptionJSON[]
  lastUnsubscribeEndpoints: string[]
  close(): Promise<void>
}

function writeSse(res: ServerResponse, event: SseEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function cors(res: ServerResponse, allowedOrigin: string): void {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
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

let sessionCounter = 0
function makeSession(req: CreateSessionRequest): ApiSession {
  sessionCounter += 1
  const id = `mock-session-${sessionCounter}`
  const now = new Date().toISOString()
  return {
    id,
    slug: `mock-${sessionCounter}`,
    status: 'pending',
    command: `/${req.mode} ${req.prompt}`,
    repo: req.repo,
    createdAt: now,
    updatedAt: now,
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: req.mode,
    conversation: [{ role: 'user', text: req.prompt }],
  }
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

  const prBySession = new Map<string, PrPreview>()
  const diffBySession = new Map<string, WireWorkspaceDiff>()
  const screenshotsBySession = new Map<string, ScreenshotEntry[]>()
  const screenshotBlobs = new Map<string, { body: Buffer; contentType: string }>()
  let vapidKey = 'BMOCK_VAPID_PUBLIC_KEY_00000000000000000000000000000000000000000000000000000000000000000000000000000000'
  const pushSubscriptions: PushSubscriptionJSON[] = []
  const lastUnsubscribeEndpoints: string[] = []

  const lastCommands: MinionCommand[] = []
  const lastMessages: Array<{ text: string; sessionId?: string }> = []
  const lastCreateSessionRequests: CreateSessionRequest[] = []
  const lastCreateVariantsRequests: CreateSessionVariantsRequest[] = []

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

  function hasFeature(name: string): boolean {
    return versionInfo.features.includes(name)
  }

  function sendJson(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  }

  function notFound(res: ServerResponse): void {
    sendJson(res, 404, { error: 'Not found' })
  }

  function featureDisabled(res: ServerResponse, name: string): void {
    sendJson(res, 404, { error: `feature '${name}' not enabled` })
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
      sendJson(res, 200, { data: versionInfo })
      return
    }

    if (!checkAuth(req, res)) return

    if (path === '/api/sessions' && req.method === 'GET') {
      sendJson(res, 200, { data: sessions })
      return
    }

    if (path === '/api/sessions' && req.method === 'POST') {
      if (!hasFeature('sessions-create')) return featureDisabled(res, 'sessions-create')
      const body = await readBody(req)
      const payload = JSON.parse(body) as CreateSessionRequest
      if (!payload.prompt || !payload.mode) {
        return sendJson(res, 400, { error: 'prompt and mode are required' })
      }
      lastCreateSessionRequests.push(payload)
      const session = makeSession(payload)
      sessions = [...sessions, session]
      sendJson(res, 200, { data: session })
      return
    }

    if (path === '/api/sessions/variants' && req.method === 'POST') {
      if (!hasFeature('sessions-variants')) return featureDisabled(res, 'sessions-variants')
      const body = await readBody(req)
      const payload = JSON.parse(body) as CreateSessionVariantsRequest
      if (!payload.prompt || !payload.mode || !payload.count || payload.count < 2) {
        return sendJson(res, 400, { error: 'prompt, mode, and count >= 2 are required' })
      }
      lastCreateVariantsRequests.push(payload)
      const groupId = `group-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const variants: ApiSession[] = []
      const results: Array<{ sessionId: string; slug: string; threadId: number }> = []
      for (let i = 0; i < payload.count; i++) {
        const s = makeSession(payload)
        s.variantGroupId = groupId
        variants.push(s)
        results.push({ sessionId: s.slug, slug: s.slug, threadId: s.threadId ?? 0 })
      }
      sessions = [...sessions, ...variants]
      sendJson(res, 200, { data: { sessions: results } })
      return
    }

    const sessionSubMatch = path.match(/^\/api\/sessions\/([^/]+)\/(pr|diff|screenshots)$/)
    if (sessionSubMatch && req.method === 'GET') {
      const sessionId = decodeURIComponent(sessionSubMatch[1])
      const kind = sessionSubMatch[2]
      if (kind === 'pr') {
        if (!hasFeature('pr-preview')) return featureDisabled(res, 'pr-preview')
        const pr = prBySession.get(sessionId)
        if (!pr) return notFound(res)
        return sendJson(res, 200, { data: pr })
      }
      if (kind === 'diff') {
        if (!hasFeature('diff-viewer')) return featureDisabled(res, 'diff-viewer')
        const diff = diffBySession.get(sessionId)
        if (!diff) return notFound(res)
        return sendJson(res, 200, { data: diff })
      }
      if (kind === 'screenshots') {
        if (!hasFeature('screenshots-http')) return featureDisabled(res, 'screenshots-http')
        const list = screenshotsBySession.get(sessionId) ?? []
        return sendJson(res, 200, { data: { sessionId, screenshots: list } satisfies ScreenshotList })
      }
    }

    const screenshotMatch = path.match(/^\/api\/screenshots\/(.+)$/)
    if (screenshotMatch && req.method === 'GET') {
      if (!hasFeature('screenshots-http')) return featureDisabled(res, 'screenshots-http')
      const file = decodeURIComponent(screenshotMatch[1])
      const blob = screenshotBlobs.get(file)
      if (!blob) return notFound(res)
      res.writeHead(200, { 'Content-Type': blob.contentType, 'Content-Length': String(blob.body.length) })
      res.end(blob.body)
      return
    }

    if (path === '/api/push/vapid-public-key' && req.method === 'GET') {
      if (!hasFeature('web-push')) return featureDisabled(res, 'web-push')
      return sendJson(res, 200, { data: { key: vapidKey } satisfies VapidPublicKey })
    }

    if (path === '/api/push-subscribe' && req.method === 'POST') {
      if (!hasFeature('web-push')) return featureDisabled(res, 'web-push')
      const body = await readBody(req)
      const sub = JSON.parse(body) as PushSubscriptionJSON
      if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        return sendJson(res, 400, { error: 'invalid subscription' })
      }
      pushSubscriptions.push(sub)
      return sendJson(res, 200, { data: { ok: true, id: `sub-${pushSubscriptions.length}` } })
    }

    if (path === '/api/push-subscribe' && req.method === 'DELETE') {
      if (!hasFeature('web-push')) return featureDisabled(res, 'web-push')
      const body = await readBody(req)
      const payload = JSON.parse(body) as { endpoint: string }
      if (!payload.endpoint) return sendJson(res, 400, { error: 'endpoint is required' })
      lastUnsubscribeEndpoints.push(payload.endpoint)
      const idx = pushSubscriptions.findIndex((s) => s.endpoint === payload.endpoint)
      if (idx !== -1) pushSubscriptions.splice(idx, 1)
      return sendJson(res, 200, { data: { ok: true } })
    }

    if (path === '/api/dags' && req.method === 'GET') {
      sendJson(res, 200, { data: dags })
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
      sendJson(res, 200, { data: { success: true } })
      return
    }

    if (path === '/api/messages' && req.method === 'POST') {
      const body = await readBody(req)
      const payload = JSON.parse(body) as { text: string; sessionId?: string }
      if (!payload.text) {
        return sendJson(res, 400, { error: 'text is required' })
      }
      lastMessages.push({ text: payload.text, sessionId: payload.sessionId })
      sendJson(res, 200, { data: { ok: true, sessionId: payload.sessionId ?? null } })
      return
    }

    notFound(res)
  })

  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve))

  const addr = server.address() as { port: number }
  const url = `http://localhost:${addr.port}`

  return {
    url,
    token,
    lastCommands,
    lastMessages,
    lastCreateSessionRequests,
    lastCreateVariantsRequests,
    pushSubscriptions,
    lastUnsubscribeEndpoints,

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

    setPr(sessionId: string, pr: PrPreview | null) {
      if (pr) prBySession.set(sessionId, pr)
      else prBySession.delete(sessionId)
    },

    setDiff(sessionId: string, diff: WireWorkspaceDiff | null) {
      if (diff) diffBySession.set(sessionId, diff)
      else diffBySession.delete(sessionId)
    },

    setScreenshots(sessionId: string, screenshots: ScreenshotEntry[]) {
      screenshotsBySession.set(sessionId, screenshots)
    },

    setScreenshotBlob(file: string, body: Buffer, contentType = 'image/png') {
      screenshotBlobs.set(file, { body, contentType })
    },

    setVapidKey(key: string) {
      vapidKey = key
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
