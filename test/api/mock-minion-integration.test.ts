// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createApiClient, ApiError } from '../../src/api/client'
import { createMockMinion, type MockMinion } from '../../e2e/fixtures/mock-minion'
import type {
  ApiSession,
  PrPreview,
  PushSubscriptionJSON,
  WorkspaceDiff,
} from '../../src/api/types'

describe('mock-minion integration', () => {
  let minion: MockMinion
  let client: ReturnType<typeof createApiClient>

  beforeAll(async () => {
    minion = await createMockMinion({ token: 'secret' })
    client = createApiClient({ baseUrl: minion.url, token: 'secret' })
  })

  afterAll(async () => {
    await minion.close()
  })

  beforeEach(() => {
    minion.setVersion({ features: [] })
  })

  it('refuses createSession when feature flag off (default)', async () => {
    await expect(client.createSession({ prompt: 'x', mode: 'task' })).rejects.toThrow(ApiError)
  })

  it('createSession works when feature enabled and records the request', async () => {
    minion.setVersion({ features: ['sessions-create'] })
    const before = minion.lastCreateSessionRequests.length
    const session = await client.createSession({ prompt: 'hello', mode: 'task', repo: 'example' })
    expect(session.mode).toBe('task')
    expect(session.repo).toBe('example')
    expect(minion.lastCreateSessionRequests.length).toBe(before + 1)
    expect(minion.lastCreateSessionRequests[before]).toEqual({ prompt: 'hello', mode: 'task', repo: 'example' })
  })

  it('createSessionVariants returns N successful slug/threadId tuples', async () => {
    minion.setVersion({ features: ['sessions-variants'] })
    const out = await client.createSessionVariants({ prompt: 'parallel', mode: 'task', count: 3 })
    expect(out.sessions).toHaveLength(3)
    const slugs = out.sessions.map((s) => ('slug' in s ? s.slug : null))
    expect(slugs.every((s) => typeof s === 'string' && s.length > 0)).toBe(true)
  })

  it('gated endpoints return 404 with a feature-disabled error when flag off', async () => {
    await expect(client.getPr('s-1')).rejects.toThrow(ApiError)
    await expect(client.getDiff('s-1')).rejects.toThrow(ApiError)
    await expect(client.listScreenshots('s-1')).rejects.toThrow(ApiError)
    await expect(client.getVapidKey()).rejects.toThrow(ApiError)
  })

  it('getPr returns the stored preview when flag on', async () => {
    minion.setVersion({ features: ['pr-preview'] })
    const pr: PrPreview = {
      number: 1,
      url: 'https://github.com/o/r/pull/1',
      title: 't',
      body: 'b',
      state: 'open',
      draft: false,
      mergeable: null,
      branch: 'feat',
      baseBranch: 'main',
      author: 'me',
      updatedAt: '2026-04-19T00:00:00Z',
      checks: [{ name: 'ci', status: 'pending' }],
    }
    minion.setPr('s-1', pr)
    const out = await client.getPr('s-1')
    expect(out).toEqual(pr)
  })

  it('getDiff returns the stored workspace diff when flag on', async () => {
    minion.setVersion({ features: ['diff'] })
    const patch = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1,1 +1,2 @@',
      '+a',
      '+b',
      '',
    ].join('\n')
    minion.setDiff('s-1', { base: 'main', head: 'feat', patch, truncated: false })
    const out: WorkspaceDiff = await client.getDiff('s-1')
    expect(out).toEqual({
      branch: 'feat',
      baseBranch: 'main',
      patch,
      truncated: false,
      stats: { filesChanged: 1, insertions: 2, deletions: 0 },
    })
  })

  it('listScreenshots + fetchScreenshotBlob round-trip', async () => {
    minion.setVersion({ features: ['screenshots'] })
    minion.setScreenshots('s-1', [
      { file: 'shot-1.png', url: '/api/screenshots/shot-1.png', capturedAt: '2026-04-19T00:00:00Z', size: 4 },
    ])
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    minion.setScreenshotBlob('shot-1.png', png)

    const list = await client.listScreenshots('s-1')
    expect(list.screenshots).toHaveLength(1)
    const entry = list.screenshots[0]
    expect(entry).toBeDefined()
    expect(entry!.file).toBe('shot-1.png')

    const blob = await client.fetchScreenshotBlob(entry!.url)
    const buf = Buffer.from(await blob.arrayBuffer())
    expect(buf.equals(png)).toBe(true)
  })

  it('submit_feedback records the command and spawns a feedback child session', async () => {
    const parent: ApiSession = {
      id: 'parent-1',
      slug: 'parent-task',
      status: 'running',
      command: '/task do thing',
      createdAt: '2026-04-19T00:00:00Z',
      updatedAt: '2026-04-19T00:00:00Z',
      childIds: [],
      needsAttention: false,
      attentionReasons: [],
      quickActions: [],
      mode: 'task',
      conversation: [],
    }
    minion.setSessions([parent])

    const before = minion.lastCommands.length
    const result = await client.sendCommand({
      action: 'submit_feedback',
      sessionId: 'parent-1',
      messageBlockId: 'block-7',
      vote: 'down',
      reason: 'incorrect',
      comment: 'wrong answer',
    })
    expect(result.success).toBe(true)

    expect(minion.lastCommands.length).toBe(before + 1)
    const recorded = minion.lastCommands[minion.lastCommands.length - 1]
    expect(recorded).toEqual({
      action: 'submit_feedback',
      sessionId: 'parent-1',
      messageBlockId: 'block-7',
      vote: 'down',
      reason: 'incorrect',
      comment: 'wrong answer',
    })

    const sessions = await client.getSessions()
    const feedback = sessions.find((s) => s.parentId === 'parent-1')
    expect(feedback).toBeDefined()
    expect(feedback!.mode).toBe('feedback')
    expect(feedback!.metadata).toMatchObject({
      kind: 'feedback',
      vote: 'down',
      reason: 'incorrect',
      comment: 'wrong answer',
      sourceSessionId: 'parent-1',
      sourceSessionSlug: 'parent-task',
      sourceMessageBlockId: 'block-7',
    })

    const updatedParent = sessions.find((s) => s.id === 'parent-1')
    expect(updatedParent?.childIds).toContain(feedback!.id)
  })

  it('submit_feedback (upvote without reason) still spawns a feedback child', async () => {
    const parent: ApiSession = {
      id: 'parent-2',
      slug: 'good-task',
      status: 'running',
      command: '/task something',
      createdAt: '2026-04-19T00:00:00Z',
      updatedAt: '2026-04-19T00:00:00Z',
      childIds: [],
      needsAttention: false,
      attentionReasons: [],
      quickActions: [],
      mode: 'task',
      conversation: [],
    }
    minion.setSessions([parent])

    await client.sendCommand({
      action: 'submit_feedback',
      sessionId: 'parent-2',
      messageBlockId: 'block-9',
      vote: 'up',
    })

    const sessions = await client.getSessions()
    const feedback = sessions.find((s) => s.parentId === 'parent-2')
    expect(feedback).toBeDefined()
    expect(feedback!.metadata).toMatchObject({
      kind: 'feedback',
      vote: 'up',
      sourceMessageBlockId: 'block-9',
    })
  })

  it('web push flow: getVapidKey → subscribe → unsubscribe', async () => {
    minion.setVersion({ features: ['web-push'] })
    const { key } = await client.getVapidKey()
    expect(key).toMatch(/^B/)

    const sub: PushSubscriptionJSON = {
      endpoint: 'https://push.example.com/abc',
      expirationTime: null,
      keys: { p256dh: 'pk', auth: 'ak' },
    }
    const ack = await client.subscribePush(sub)
    expect(ack.ok).toBe(true)
    expect(minion.pushSubscriptions).toContainEqual(sub)

    await client.unsubscribePush(sub.endpoint)
    expect(minion.lastUnsubscribeEndpoints).toContain(sub.endpoint)
    expect(minion.pushSubscriptions.find((s) => s.endpoint === sub.endpoint)).toBeUndefined()
  })
})
