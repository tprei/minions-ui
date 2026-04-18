import { render, screen, fireEvent, waitFor } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChatPanel } from '../../src/chat/ChatPanel'
import type { ApiSession } from '../../src/api/types'

const session: ApiSession = {
  id: 's1',
  slug: 'brave-fox',
  status: 'running',
  command: '/task foo',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  childIds: [],
  needsAttention: false,
  attentionReasons: [],
  quickActions: [
    { type: 'make_pr', label: 'Make PR', message: '/ship' },
  ],
  mode: 'task',
  conversation: [
    { role: 'user', text: 'hello' },
    { role: 'assistant', text: 'hi there' },
  ],
}

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
}

beforeEach(() => {
  setMatchMedia(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChatPanel', () => {
  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<ChatPanel session={session} onClose={onClose} onSend={vi.fn()} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when backdrop is clicked (mobile viewport)', () => {
    setMatchMedia(false)
    const onClose = vi.fn()
    render(<ChatPanel session={session} onClose={onClose} onSend={vi.fn()} />)
    const backdrop = document.querySelector('.bg-black\\/50')
    if (backdrop) fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('renders conversation messages', () => {
    render(<ChatPanel session={session} onClose={vi.fn()} onSend={vi.fn()} />)
    expect(screen.getByText('hello')).toBeTruthy()
    expect(screen.getByText('hi there')).toBeTruthy()
  })

  it('renders quick action buttons', () => {
    render(<ChatPanel session={session} onClose={vi.fn()} onSend={vi.fn()} />)
    expect(screen.getByText('Make PR')).toBeTruthy()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<ChatPanel session={session} onClose={onClose} onSend={vi.fn()} />)
    fireEvent.click(screen.getByTestId('chat-close-btn'))
    expect(onClose).toHaveBeenCalled()
  })

  it('happy path: type /task foo, click Send, onSend called with text and sessionId', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<ChatPanel session={session} onClose={vi.fn()} onSend={onSend} />)
    const textarea = screen.getByTestId('message-textarea')
    fireEvent.input(textarea, { target: { value: '/task foo' } })
    fireEvent.click(screen.getByTestId('send-btn'))
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith('/task foo', session.id)
    )
  })

  it('shows reconnecting badge when sseStatus is not live', () => {
    render(
      <ChatPanel session={session} onClose={vi.fn()} onSend={vi.fn()} sseStatus="retrying" />
    )
    expect(screen.getByTestId('reconnecting-badge')).toBeTruthy()
  })

  it('does not show reconnecting badge when sseStatus is live', () => {
    render(
      <ChatPanel session={session} onClose={vi.fn()} onSend={vi.fn()} sseStatus="live" />
    )
    expect(screen.queryByTestId('reconnecting-badge')).toBeNull()
  })
})
