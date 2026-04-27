import { render, screen, fireEvent, waitFor } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signal } from '@preact/signals'
import { FeedbackButtons } from '../../../src/chat/transcript/FeedbackButtons'
import type { ConnectionStore } from '../../../src/state/types'
import type { CommandResult } from '../../../src/api/types'

vi.mock('../../../src/state/feedback-persist', () => ({
  useFeedbackStore: vi.fn(() => signal({})),
  recordFeedback: vi.fn().mockResolvedValue(undefined),
}))

import { useFeedbackStore, recordFeedback } from '../../../src/state/feedback-persist'

beforeEach(() => {
  vi.clearAllMocks()
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
  }
})

function createMockStore(features: string[] = ['message-feedback']): ConnectionStore {
  const submitFeedback = vi.fn().mockResolvedValue({ success: true } as CommandResult)

  return {
    connectionId: 'conn-1',
    version: signal({ apiVersion: '2.0.0', libraryVersion: '1.110.0', features }),
    client: {
      submitFeedback,
    },
  } as unknown as ConnectionStore
}

describe('FeedbackButtons', () => {
  it('renders nothing when message-feedback feature is absent', () => {
    const store = createMockStore([])
    const { container } = render(
      <FeedbackButtons sessionId="s1" blockId="block1" store={store} />,
    )
    expect(container.textContent).toBe('')
  })

  it('renders thumbs-up and thumbs-down buttons when feature is present', () => {
    const store = createMockStore()
    render(<FeedbackButtons sessionId="s1" blockId="block1" store={store} />)

    expect(screen.getByTestId('feedback-thumbs-up')).toBeTruthy()
    expect(screen.getByTestId('feedback-thumbs-down')).toBeTruthy()
  })

  it('submits thumbs-up immediately and shows thanks', async () => {
    const store = createMockStore()
    vi.mocked(useFeedbackStore).mockReturnValue(signal({}))

    render(<FeedbackButtons sessionId="s1" blockId="block1" store={store} />)

    const upBtn = screen.getByTestId('feedback-thumbs-up')
    fireEvent.click(upBtn)

    await waitFor(() => {
      expect(store.client.submitFeedback).toHaveBeenCalledWith({
        sessionId: 's1',
        messageBlockId: 'block1',
        vote: 'up',
      })
    })

    await waitFor(() => {
      expect(recordFeedback).toHaveBeenCalledWith('conn-1', 's1:block1', {
        vote: 'up',
        ts: expect.any(Number),
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('feedback-thanks')).toBeTruthy()
      expect(screen.getByText('Thanks!')).toBeTruthy()
    })
  })

  it('opens reason popup on thumbs-down click', async () => {
    const store = createMockStore()
    vi.mocked(useFeedbackStore).mockReturnValue(signal({}))

    render(<FeedbackButtons sessionId="s1" blockId="block1" store={store} />)

    const downBtn = screen.getByTestId('feedback-thumbs-down')
    fireEvent.click(downBtn)

    await waitFor(() => {
      expect(screen.getByTestId('feedback-reason-popup')).toBeTruthy()
    })
  })

  it('submits thumbs-down with reason from popup', async () => {
    const store = createMockStore()
    vi.mocked(useFeedbackStore).mockReturnValue(signal({}))

    render(<FeedbackButtons sessionId="s1" blockId="block1" store={store} />)

    fireEvent.click(screen.getByTestId('feedback-thumbs-down'))
    await waitFor(() => expect(screen.getByTestId('feedback-reason-popup')).toBeTruthy())

    fireEvent.click(screen.getByTestId('feedback-reason-incorrect'))

    const commentArea = screen.getByTestId('feedback-comment') as HTMLTextAreaElement
    fireEvent.input(commentArea, { target: { value: 'Too many errors' } })

    fireEvent.click(screen.getByTestId('feedback-submit'))

    await waitFor(() => {
      expect(store.client.submitFeedback).toHaveBeenCalledWith({
        sessionId: 's1',
        messageBlockId: 'block1',
        vote: 'down',
        reason: 'incorrect',
        comment: 'Too many errors',
      })
    })

    await waitFor(() => {
      expect(recordFeedback).toHaveBeenCalledWith('conn-1', 's1:block1', {
        vote: 'down',
        reason: 'incorrect',
        comment: 'Too many errors',
        ts: expect.any(Number),
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('feedback-thanks')).toBeTruthy()
    })
  })

  it('shows selected state for thumbs-up', () => {
    const store = createMockStore()
    vi.mocked(useFeedbackStore).mockReturnValue(
      signal({
        's1:block1': { vote: 'up', ts: Date.now() },
      }),
    )

    render(<FeedbackButtons sessionId="s1" blockId="block1" store={store} />)

    const upBtn = screen.getByTestId('feedback-thumbs-up')
    expect(upBtn.getAttribute('data-selected')).toBe('true')
  })

  it('shows selected state for thumbs-down', () => {
    const store = createMockStore()
    vi.mocked(useFeedbackStore).mockReturnValue(
      signal({
        's1:block1': { vote: 'down', reason: 'incorrect', ts: Date.now() },
      }),
    )

    render(<FeedbackButtons sessionId="s1" blockId="block1" store={store} />)

    const downBtn = screen.getByTestId('feedback-thumbs-down')
    expect(downBtn.getAttribute('data-selected')).toBe('true')
  })

  it('shows error when submission fails', async () => {
    const store = createMockStore()
    vi.mocked(store.client.submitFeedback).mockResolvedValue({
      success: false,
      error: 'Network error',
    })
    vi.mocked(useFeedbackStore).mockReturnValue(signal({}))

    render(<FeedbackButtons sessionId="s1" blockId="block1" store={store} />)

    fireEvent.click(screen.getByTestId('feedback-thumbs-up'))

    await waitFor(() => {
      expect(screen.getByTestId('feedback-error')).toBeTruthy()
      expect(screen.getByText('Network error')).toBeTruthy()
    })
  })

  it('disables buttons when persisted is false', () => {
    const store = createMockStore()
    vi.mocked(useFeedbackStore).mockReturnValue(signal({}))

    render(<FeedbackButtons sessionId="s1" blockId="block1" store={store} persisted={false} />)

    const upBtn = screen.getByTestId('feedback-thumbs-up')
    const downBtn = screen.getByTestId('feedback-thumbs-down')

    expect(upBtn.hasAttribute('disabled')).toBe(true)
    expect(downBtn.hasAttribute('disabled')).toBe(true)
  })

  it('does not call submitFeedback multiple times when clicked rapidly', async () => {
    const store = createMockStore()
    vi.mocked(useFeedbackStore).mockReturnValue(signal({}))

    render(<FeedbackButtons sessionId="s1" blockId="block1" store={store} />)

    const upBtn = screen.getByTestId('feedback-thumbs-up')
    fireEvent.click(upBtn)
    fireEvent.click(upBtn)
    fireEvent.click(upBtn)

    await waitFor(() => {
      expect(store.client.submitFeedback).toHaveBeenCalledTimes(1)
    })
  })
})
