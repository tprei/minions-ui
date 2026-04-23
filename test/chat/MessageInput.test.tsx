import { render, screen, fireEvent, waitFor, act } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import { MessageInput } from '../../src/chat/MessageInput'
import type { ApiSession } from '../../src/api/types'
import type { ConnectionStore } from '../../src/state/types'

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

const mockStore = {
  version: signal({ apiVersion: '2.0.0', libraryVersion: '0.1.0', features: ['sessions-create-images'] as string[] }),
} as unknown as ConnectionStore

function Controlled({ onSend, store = mockStore }: { onSend: (text: string, images?: Array<{ mediaType: string; dataBase64: string }>) => Promise<void>; store?: ConnectionStore }) {
  const [text, setText] = useState('')
  return <MessageInput session={session} store={store} onSend={onSend} value={text} onValueChange={setText} />
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
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hello world', undefined))
  })

  it('calls onSend when Enter is pressed (no shift)', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<Controlled onSend={onSend} />)
    fireEvent.input(getTextarea(), { target: { value: 'enter test' } })
    fireEvent.keyDown(getTextarea(), { key: 'Enter', shiftKey: false })
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('enter test', undefined))
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
    expect(onSend).toHaveBeenNthCalledWith(2, 'retry me', undefined)
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

describe('MessageInput · image attachments', () => {
  let createdUrls: string[]
  let revokedUrls: string[]

  beforeEach(() => {
    createdUrls = []
    revokedUrls = []
    let counter = 0
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => {
        const url = `blob:mock-${counter++}`
        createdUrls.push(url)
        return url
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revokedUrls.push(url)
      }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows paperclip attach button', () => {
    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.getByTestId('attach-btn')).toBeTruthy()
  })

  it('paste event with image file queues attachment and shows thumbnail strip', async () => {
    const fakeBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
    const fakeFile = new File([fakeBlob], 'paste.png', { type: 'image/png' })

    interface FileReaderStub {
      result: string | ArrayBuffer | null
      onload: ((ev: ProgressEvent) => void) | null
      onerror: ((ev: ProgressEvent) => void) | null
    }
    const readAsDataURLMock = vi.fn().mockImplementation(function (this: FileReaderStub) {
      Promise.resolve().then(() => {
        Object.defineProperty(this, 'result', { value: 'data:image/png;base64,abc123', configurable: true })
        this.onload?.call(this, new ProgressEvent('load'))
      })
    })
    vi.stubGlobal('FileReader', class {
      result: string | ArrayBuffer | null = null
      onload: ((ev: ProgressEvent) => void) | null = null
      onerror: ((ev: ProgressEvent) => void) | null = null
      readAsDataURL = readAsDataURLMock
    })

    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)

    const dt = {
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => fakeFile },
      ],
    }
    const textarea = screen.getByTestId('message-textarea')
    fireEvent(textarea, Object.assign(new Event('paste', { bubbles: true }), { clipboardData: dt }))

    await waitFor(() => expect(screen.getByTestId('attachment-strip')).toBeTruthy())
    expect(screen.getByTestId('remove-attachment-0')).toBeTruthy()
  })

  it('sends images with text when onSend is called', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    const fakeFile = new File([new Uint8Array([1, 2, 3])], 'img.png', { type: 'image/png' })

    vi.stubGlobal('FileReader', class {
      result: string | ArrayBuffer | null = null
      onload: ((ev: ProgressEvent) => void) | null = null
      onerror: ((ev: ProgressEvent) => void) | null = null
      readAsDataURL = vi.fn().mockImplementation(function (this: { result: string | null; onload: ((ev: ProgressEvent) => void) | null }) {
        Promise.resolve().then(() => {
          this.result = 'data:image/png;base64,dGVzdA=='
          this.onload?.call(this, new ProgressEvent('load'))
        })
      })
    })

    render(<Controlled onSend={onSend} />)

    const dt = {
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => fakeFile },
      ],
    }
    const textarea = screen.getByTestId('message-textarea')
    fireEvent(textarea, Object.assign(new Event('paste', { bubbles: true }), { clipboardData: dt }))

    await waitFor(() => expect(screen.getByTestId('attachment-strip')).toBeTruthy())

    fireEvent.input(textarea, { target: { value: 'look at this' } })
    fireEvent.click(screen.getByTestId('send-btn'))

    await waitFor(() => expect(onSend).toHaveBeenCalled())
    const [text, images] = onSend.mock.calls[0] as [string, Array<{ mediaType: string; dataBase64: string }>]
    expect(text).toBe('look at this')
    expect(Array.isArray(images)).toBe(true)
    expect(images[0]).toMatchObject({ mediaType: 'image/png' })
  })

  it('remove button dismisses an attachment', async () => {
    const fakeFile = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' })

    vi.stubGlobal('FileReader', class {
      result: string | ArrayBuffer | null = null
      onload: ((ev: ProgressEvent) => void) | null = null
      onerror: ((ev: ProgressEvent) => void) | null = null
      readAsDataURL = vi.fn().mockImplementation(function (this: { result: string | null; onload: ((ev: ProgressEvent) => void) | null }) {
        Promise.resolve().then(() => {
          this.result = 'data:image/png;base64,YQ=='
          this.onload?.call(this, new ProgressEvent('load'))
        })
      })
    })

    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)

    const dt = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => fakeFile }],
    }
    const textarea = screen.getByTestId('message-textarea')
    fireEvent(textarea, Object.assign(new Event('paste', { bubbles: true }), { clipboardData: dt }))

    await waitFor(() => expect(screen.getByTestId('remove-attachment-0')).toBeTruthy())
    fireEvent.click(screen.getByTestId('remove-attachment-0'))
    await waitFor(() => expect(screen.queryByTestId('attachment-strip')).toBeNull())
    expect(revokedUrls.length).toBeGreaterThan(0)
  })
})
