import { render, screen, fireEvent, waitFor, act } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageInput } from '../../src/chat/MessageInput'
import type { ApiSession } from '../../src/api/types'

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

const session: ApiSession = {
  id: 's1',
  slug: 'test-session',
  status: 'running',
  command: '/task foo',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  childIds: [],
  needsAttention: false,
  attentionReasons: [],
  quickActions: [],
  mode: 'task',
  conversation: [],
}

function getTextarea() {
  return screen.getByTestId('message-textarea') as HTMLTextAreaElement
}

function getSendBtn() {
  return screen.getByTestId('send-btn')
}

describe('MessageInput', () => {
  it('calls onSend with typed text when Send button is clicked', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<MessageInput session={session} onSend={onSend} />)
    fireEvent.input(getTextarea(), { target: { value: 'hello world' } })
    fireEvent.click(getSendBtn())
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hello world'))
  })

  it('calls onSend when Enter is pressed (no shift)', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<MessageInput session={session} onSend={onSend} />)
    fireEvent.input(getTextarea(), { target: { value: 'enter test' } })
    fireEvent.keyDown(getTextarea(), { key: 'Enter', shiftKey: false })
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('enter test'))
  })

  it('inserts newline on Shift+Enter without submitting', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<MessageInput session={session} onSend={onSend} />)
    fireEvent.input(getTextarea(), { target: { value: 'line1' } })
    fireEvent.keyDown(getTextarea(), { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('disables input and button while onSend is pending', async () => {
    let resolve: () => void
    const onSend = vi.fn().mockReturnValue(new Promise<void>((r) => { resolve = r }))
    render(<MessageInput session={session} onSend={onSend} />)
    fireEvent.input(getTextarea(), { target: { value: 'pending test' } })
    act(() => {
      fireEvent.click(getSendBtn())
    })
    await waitFor(() => {
      expect(getTextarea().disabled).toBe(true)
      expect(getSendBtn().hasAttribute('disabled')).toBe(true)
    })
    act(() => { resolve!() })
  })

  it('shows retry banner when onSend rejects', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('network error'))
    render(<MessageInput session={session} onSend={onSend} />)
    fireEvent.input(getTextarea(), { target: { value: 'will fail' } })
    fireEvent.click(getSendBtn())
    await waitFor(() => expect(screen.getByText(/Send failed/)).toBeTruthy())
    expect(screen.getByTestId('retry-btn')).toBeTruthy()
  })

  it('re-sends on retry click', async () => {
    let callCount = 0
    const onSend = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.reject(new Error('fail'))
      return Promise.resolve()
    })
    render(<MessageInput session={session} onSend={onSend} />)
    fireEvent.input(getTextarea(), { target: { value: 'retry me' } })
    fireEvent.click(getSendBtn())
    await waitFor(() => expect(screen.getByTestId('retry-btn')).toBeTruthy())
    fireEvent.click(screen.getByTestId('retry-btn'))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2))
    expect(onSend).toHaveBeenNthCalledWith(2, 'retry me')
  })
})
