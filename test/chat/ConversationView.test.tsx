import { render, screen } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConversationView } from '../../src/chat/ConversationView'
import type { ConversationMessage } from '../../src/api/types'

beforeEach(() => {
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

function makeMessages(overrides: Partial<ConversationMessage>[] = []): ConversationMessage[] {
  return overrides.map((o) => ({ role: 'user', text: 'hello', ...o }))
}

describe('ConversationView', () => {
  it('renders user messages right-aligned', () => {
    render(<ConversationView messages={makeMessages([{ role: 'user', text: 'Hello' }])} />)
    const bubble = screen.getByText('Hello').closest('[data-testid="message-user"]')
    expect(bubble).toBeTruthy()
    expect(bubble?.className).toContain('justify-end')
  })

  it('renders assistant messages left-aligned', () => {
    render(<ConversationView messages={makeMessages([{ role: 'assistant', text: 'Hi there' }])} />)
    const bubble = screen.getByText('Hi there').closest('[data-testid="message-assistant"]')
    expect(bubble).toBeTruthy()
    expect(bubble?.className).toContain('justify-start')
  })

  it('renders multiple messages', () => {
    const msgs: ConversationMessage[] = [
      { role: 'user', text: 'msg1' },
      { role: 'assistant', text: 'msg2' },
      { role: 'user', text: 'msg3' },
    ]
    render(<ConversationView messages={msgs} />)
    expect(screen.getByText('msg1')).toBeTruthy()
    expect(screen.getByText('msg2')).toBeTruthy()
    expect(screen.getByText('msg3')).toBeTruthy()
  })

  it('renders empty state with no messages', () => {
    render(<ConversationView messages={[]} />)
    expect(screen.getByTestId('conversation-view')).toBeTruthy()
  })

  it('scrolls to bottom when new message appended and user is near bottom', () => {
    const scrollToBottomSpy = vi.fn()
    const { rerender } = render(
      <ConversationView messages={[{ role: 'user', text: 'first' }]} />
    )
    const container = screen.getByTestId('conversation-view')
    Object.defineProperty(container, 'clientHeight', { writable: true, configurable: true, value: 400 })
    Object.defineProperty(container, 'scrollHeight', { writable: true, configurable: true, value: 400 })
    Object.defineProperty(container, 'scrollTop', {
      set: scrollToBottomSpy,
      get: () => 320,
      configurable: true,
    })

    rerender(<ConversationView messages={[
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'second' },
    ]} />)

    expect(scrollToBottomSpy).toHaveBeenCalled()
  })

  it('does not scroll when user is scrolled up', () => {
    const scrollToBottomSpy = vi.fn()
    const { rerender } = render(
      <ConversationView messages={[{ role: 'user', text: 'first' }]} />
    )
    const container = screen.getByTestId('conversation-view')
    Object.defineProperty(container, 'clientHeight', { writable: true, configurable: true, value: 200 })
    Object.defineProperty(container, 'scrollHeight', { writable: true, configurable: true, value: 800 })
    Object.defineProperty(container, 'scrollTop', {
      set: scrollToBottomSpy,
      get: () => 0,
      configurable: true,
    })

    rerender(<ConversationView messages={[
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'second' },
    ]} />)

    expect(scrollToBottomSpy).not.toHaveBeenCalled()
  })
})
