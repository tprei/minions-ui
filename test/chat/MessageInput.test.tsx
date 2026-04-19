import { render, screen, fireEvent, waitFor, act } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'preact/hooks'
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

function Controlled({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  return <MessageInput session={session} onSend={onSend} value={text} onValueChange={setText} />
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
    render(<Controlled onSend={onSend} />)
    fireEvent.input(getTextarea(), { target: { value: 'hello world' } })
    fireEvent.click(getSendBtn())
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hello world'))
  })

  it('calls onSend when Enter is pressed (no shift)', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<Controlled onSend={onSend} />)
    fireEvent.input(getTextarea(), { target: { value: 'enter test' } })
    fireEvent.keyDown(getTextarea(), { key: 'Enter', shiftKey: false })
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('enter test'))
  })

  it('inserts newline on Shift+Enter without submitting', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<Controlled onSend={onSend} />)
    fireEvent.input(getTextarea(), { target: { value: 'line1' } })
    fireEvent.keyDown(getTextarea(), { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('disables input and button while onSend is pending', async () => {
    let resolve: () => void
    const onSend = vi.fn().mockReturnValue(new Promise<void>((r) => { resolve = r }))
    render(<Controlled onSend={onSend} />)
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
    render(<Controlled onSend={onSend} />)
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
    render(<Controlled onSend={onSend} />)
    fireEvent.input(getTextarea(), { target: { value: 'retry me' } })
    fireEvent.click(getSendBtn())
    await waitFor(() => expect(screen.getByTestId('retry-btn')).toBeTruthy())
    fireEvent.click(screen.getByTestId('retry-btn'))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2))
    expect(onSend).toHaveBeenNthCalledWith(2, 'retry me')
  })

  it('renders the composer toolbar with kbd hints', () => {
    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)
    const toolbar = screen.getByTestId('composer-toolbar')
    expect(toolbar.textContent).toContain('Enter')
    expect(toolbar.textContent).toContain('send')
    expect(toolbar.textContent).toContain('newline')
  })

  it('shows char count when text is entered', () => {
    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.queryByTestId('composer-char-count')).toBeNull()
    fireEvent.input(getTextarea(), { target: { value: 'hello' } })
    expect(screen.getByTestId('composer-char-count').textContent).toBe('5')
  })

  it('shows slash command indicator when input begins with /', () => {
    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.queryByTestId('composer-slash-indicator')).toBeNull()
    fireEvent.input(getTextarea(), { target: { value: '/stop' } })
    expect(screen.getByTestId('composer-slash-indicator')).toBeTruthy()
  })

  it('uses agent-focused placeholder copy (no Telegram phrasing)', () => {
    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)
    const placeholder = getTextarea().getAttribute('placeholder') ?? ''
    expect(placeholder.toLowerCase()).not.toContain('telegram')
    expect(placeholder).toContain('agent')
  })
})

describe('MessageInput · voice input', () => {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  const originalSR = w.SpeechRecognition
  const originalWebkit = w.webkitSpeechRecognition

  afterEach(() => {
    w.SpeechRecognition = originalSR
    w.webkitSpeechRecognition = originalWebkit
  })

  it('hides mic button when SpeechRecognition is unsupported', () => {
    delete w.SpeechRecognition
    delete w.webkitSpeechRecognition
    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.queryByTestId('mic-btn')).toBeNull()
  })

  it('shows mic button and toggles recording state when supported', async () => {
    class FakeRec extends EventTarget implements SpeechRecognition {
      continuous = false
      interimResults = false
      lang = ''
      maxAlternatives = 1
      onstart: ((this: SpeechRecognition, ev: Event) => void) | null = null
      onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null = null
      onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null = null
      onend: ((this: SpeechRecognition, ev: Event) => void) | null = null
      start() {
        this.onstart?.call(this, new Event('start'))
      }
      stop() {
        this.onend?.call(this, new Event('end'))
      }
      abort() {
        this.onend?.call(this, new Event('end'))
      }
    }
    w.SpeechRecognition = FakeRec as unknown as SpeechRecognitionConstructor
    delete w.webkitSpeechRecognition
    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)
    const mic = screen.getByTestId('mic-btn') as HTMLButtonElement
    expect(mic.getAttribute('aria-pressed')).toBe('false')
    act(() => {
      fireEvent.click(mic)
    })
    await waitFor(() => expect(mic.getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByTestId('composer-recording-indicator')).toBeTruthy()
    act(() => {
      fireEvent.click(mic)
    })
    await waitFor(() => expect(mic.getAttribute('aria-pressed')).toBe('false'))
  })

  it('appends final transcript to existing input', async () => {
    const instances: SpeechRecognition[] = []
    class FakeRec extends EventTarget implements SpeechRecognition {
      continuous = false
      interimResults = false
      lang = ''
      maxAlternatives = 1
      onstart: ((this: SpeechRecognition, ev: Event) => void) | null = null
      onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null = null
      onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null = null
      onend: ((this: SpeechRecognition, ev: Event) => void) | null = null
      start() {
        this.onstart?.call(this, new Event('start'))
      }
      stop() {
        this.onend?.call(this, new Event('end'))
      }
      abort() {
        this.onend?.call(this, new Event('end'))
      }
    }
    const Ctor = function () {
      const rec = new FakeRec()
      instances.push(rec)
      return rec
    } as unknown as SpeechRecognitionConstructor
    w.SpeechRecognition = Ctor
    delete w.webkitSpeechRecognition
    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.input(getTextarea(), { target: { value: 'hello' } })
    act(() => {
      fireEvent.click(screen.getByTestId('mic-btn'))
    })
    await waitFor(() => expect(instances.length).toBe(1))
    const rec = instances[0]
    act(() => {
      const result = Object.assign([{ transcript: 'world', confidence: 1 }], {
        isFinal: true,
        length: 1,
        item() {
          return { transcript: 'world', confidence: 1 }
        },
      })
      const results = Object.assign([result], {
        length: 1,
        item() {
          return result
        },
      }) as unknown as SpeechRecognitionResultList
      const event = Object.assign(new Event('result'), {
        resultIndex: 0,
        results,
      }) as unknown as SpeechRecognitionEvent
      rec.onresult?.call(rec, event)
    })
    await waitFor(() => expect(getTextarea().value).toBe('hello world'))
  })
})
