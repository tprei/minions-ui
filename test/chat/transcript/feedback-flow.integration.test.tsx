import { render, screen, fireEvent, waitFor } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { signal } from '@preact/signals'

const idbStore = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: vi.fn((k: string) => Promise.resolve(idbStore.get(k))),
  set: vi.fn((k: string, v: unknown) => {
    idbStore.set(k, v)
    return Promise.resolve()
  }),
  del: vi.fn((k: string) => {
    idbStore.delete(k)
    return Promise.resolve()
  }),
}))

import { FeedbackButtons } from '../../../src/chat/transcript/FeedbackButtons'
import {
  loadFeedback,
  useFeedbackStore,
  __clearCache,
} from '../../../src/state/feedback-persist'
import { createApiClient } from '../../../src/api/client'
import type { ConnectionStore } from '../../../src/state/types'

function buildStore(features: string[], client: ReturnType<typeof createApiClient>): ConnectionStore {
  return {
    connectionId: 'conn-int',
    client,
    version: signal({ apiVersion: '2.0.0', libraryVersion: '1.110.0', features }),
  } as unknown as ConnectionStore
}

const fetchMock = vi.fn()

beforeEach(() => {
  idbStore.clear()
  __clearCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('feedback flow integration', () => {
  it('feedback-persist round-trip survives a fresh load via IDB', async () => {
    await loadFeedback('conn-int')

    const client = createApiClient({ baseUrl: 'http://api.test', token: 't' })
    const store = buildStore(['message-feedback'], client)

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { success: true } }), { status: 200 }),
    )

    render(<FeedbackButtons sessionId="s-int" blockId="b-int" store={store} />)

    fireEvent.click(screen.getByTestId('feedback-thumbs-up'))

    await waitFor(() => {
      expect(screen.getByTestId('feedback-thanks')).toBeTruthy()
    })

    __clearCache()
    const reloaded = await loadFeedback('conn-int')
    expect(reloaded['s-int:b-int']).toMatchObject({ vote: 'up' })
    expect(typeof reloaded['s-int:b-int'].ts).toBe('number')
  })

  it('renders nothing when message-feedback feature flag is absent', () => {
    const client = createApiClient({ baseUrl: 'http://api.test', token: 't' })
    const store = buildStore([], client)

    const { container } = render(
      <FeedbackButtons sessionId="s1" blockId="b1" store={store} />,
    )
    expect(container.textContent).toBe('')
    expect(container.querySelector('[data-testid="feedback-buttons"]')).toBeNull()
  })

  it('thumbs-up submits immediately without opening the reason popup', async () => {
    const client = createApiClient({ baseUrl: 'http://api.test', token: 't' })
    const store = buildStore(['message-feedback'], client)

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { success: true } }), { status: 200 }),
    )

    render(<FeedbackButtons sessionId="s-up" blockId="b-up" store={store} />)
    fireEvent.click(screen.getByTestId('feedback-thumbs-up'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    expect(screen.queryByTestId('feedback-reason-popup')).toBeNull()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api.test/api/commands')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({
      action: 'submit_feedback',
      sessionId: 's-up',
      messageBlockId: 'b-up',
      vote: 'up',
      reason: undefined,
      comment: undefined,
    })

    await waitFor(() => {
      expect(screen.getByTestId('feedback-thanks')).toBeTruthy()
    })
  })

  it('thumbs-down opens the popup and submits with chosen reason + comment', async () => {
    const client = createApiClient({ baseUrl: 'http://api.test', token: 't' })
    const store = buildStore(['message-feedback'], client)

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { success: true } }), { status: 200 }),
    )

    render(<FeedbackButtons sessionId="s-dn" blockId="b-dn" store={store} />)

    fireEvent.click(screen.getByTestId('feedback-thumbs-down'))

    await waitFor(() => {
      expect(screen.getByTestId('feedback-reason-popup')).toBeTruthy()
    })
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('feedback-reason-too_verbose'))
    fireEvent.input(screen.getByTestId('feedback-comment'), {
      target: { value: '  Walls of text  ' },
    })

    fireEvent.click(screen.getByTestId('feedback-submit'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      action: 'submit_feedback',
      sessionId: 's-dn',
      messageBlockId: 'b-dn',
      vote: 'down',
      reason: 'too_verbose',
      comment: 'Walls of text',
    })

    await waitFor(() => {
      const persisted = useFeedbackStore('conn-int').value['s-dn:b-dn']
      expect(persisted).toBeTruthy()
      expect(persisted.vote).toBe('down')
      expect(persisted.reason).toBe('too_verbose')
      expect(persisted.comment).toBe('Walls of text')
    })
  })

  it('renders persisted thumbs-down selection on remount after loadFeedback', async () => {
    const client = createApiClient({ baseUrl: 'http://api.test', token: 't' })
    const store = buildStore(['message-feedback'], client)

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { success: true } }), { status: 200 }),
    )

    const { unmount } = render(
      <FeedbackButtons sessionId="s-persist" blockId="b-persist" store={store} />,
    )
    fireEvent.click(screen.getByTestId('feedback-thumbs-up'))
    await waitFor(() => {
      expect(screen.getByTestId('feedback-thanks')).toBeTruthy()
    })
    unmount()

    __clearCache()
    await loadFeedback('conn-int')

    render(<FeedbackButtons sessionId="s-persist" blockId="b-persist" store={store} />)
    const upBtn = screen.getByTestId('feedback-thumbs-up')
    expect(upBtn.getAttribute('data-selected')).toBe('true')
  })
})
