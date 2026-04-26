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

  it('triggers haptic feedback when send button is clicked', async () => {
    const vibrateSpy = vi.fn()
    Object.defineProperty(navigator, 'vibrate', {
      writable: true,
      configurable: true,
      value: vibrateSpy,
    })
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<Controlled onSend={onSend} />)
    fireEvent.input(getTextarea(), { target: { value: 'test message' } })
    fireEvent.click(getSendBtn())
    expect(vibrateSpy).toHaveBeenCalledWith(10)
    await waitFor(() => expect(onSend).toHaveBeenCalled())
  })

  it('triggers haptic feedback when Enter is pressed', async () => {
    const vibrateSpy = vi.fn()
    Object.defineProperty(navigator, 'vibrate', {
      writable: true,
      configurable: true,
      value: vibrateSpy,
    })
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<Controlled onSend={onSend} />)
    fireEvent.input(getTextarea(), { target: { value: 'enter message' } })
    fireEvent.keyDown(getTextarea(), { key: 'Enter', shiftKey: false })
    expect(vibrateSpy).toHaveBeenCalledWith(10)
    await waitFor(() => expect(onSend).toHaveBeenCalled())
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

  function mockFileReader() {
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
  }

  it('shows paperclip attach button', () => {
    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.getByTestId('attach-btn')).toBeTruthy()
  })

  it('paste event with image file queues attachment and shows thumbnail strip', async () => {
    const fakeFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'paste.png', { type: 'image/png' })
    mockFileReader()

    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)

    const dt = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => fakeFile }],
    }
    const textarea = screen.getByTestId('message-textarea')
    fireEvent(textarea, Object.assign(new Event('paste', { bubbles: true }), { clipboardData: dt }))

    await waitFor(() => expect(screen.getByTestId('attachment-strip')).toBeTruthy())
    expect(screen.getByTestId('remove-attachment-0')).toBeTruthy()
  })

  it('paste ignores non-image items', async () => {
    const textFile = new File(['hello'], 'doc.txt', { type: 'text/plain' })
    mockFileReader()

    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)

    const dt = {
      items: [{ kind: 'file', type: 'text/plain', getAsFile: () => textFile }],
    }
    const textarea = screen.getByTestId('message-textarea')
    fireEvent(textarea, Object.assign(new Event('paste', { bubbles: true }), { clipboardData: dt }))

    await waitFor(() => new Promise((r) => setTimeout(r, 50)))
    expect(screen.queryByTestId('attachment-strip')).toBeNull()
  })

  it('paste filters mixed clipboard content to only valid image types', async () => {
    const pngFile = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' })
    const jpegFile = new File([new Uint8Array([2])], 'photo.jpg', { type: 'image/jpeg' })
    const textFile = new File(['text'], 'doc.txt', { type: 'text/plain' })
    mockFileReader()

    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)

    const dt = {
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => pngFile },
        { kind: 'file', type: 'text/plain', getAsFile: () => textFile },
        { kind: 'file', type: 'image/jpeg', getAsFile: () => jpegFile },
      ],
    }
    const textarea = screen.getByTestId('message-textarea')
    fireEvent(textarea, Object.assign(new Event('paste', { bubbles: true }), { clipboardData: dt }))

    await waitFor(() => expect(screen.getByTestId('attachment-strip')).toBeTruthy())
    expect(screen.getByTestId('remove-attachment-0')).toBeTruthy()
    expect(screen.getByTestId('remove-attachment-1')).toBeTruthy()
    expect(screen.queryByTestId('remove-attachment-2')).toBeNull()
  })

  it('file-pick via attach button queues selected images', async () => {
    const file1 = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
    const file2 = new File([new Uint8Array([2])], 'b.webp', { type: 'image/webp' })
    mockFileReader()

    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)

    const input = screen.getByTestId('file-input') as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [file1, file2],
      configurable: true,
    })

    fireEvent.change(input)

    await waitFor(() => expect(screen.getByTestId('attachment-strip')).toBeTruthy())
    expect(screen.getByTestId('remove-attachment-0')).toBeTruthy()
    expect(screen.getByTestId('remove-attachment-1')).toBeTruthy()
  })

  it('file-pick filters out non-image files', async () => {
    const imgFile = new File([new Uint8Array([1])], 'img.gif', { type: 'image/gif' })
    const pdfFile = new File([new Uint8Array([2])], 'doc.pdf', { type: 'application/pdf' })
    mockFileReader()

    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)

    const input = screen.getByTestId('file-input') as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [imgFile, pdfFile],
      configurable: true,
    })

    fireEvent.change(input)

    await waitFor(() => expect(screen.getByTestId('attachment-strip')).toBeTruthy())
    expect(screen.getByTestId('remove-attachment-0')).toBeTruthy()
    expect(screen.queryByTestId('remove-attachment-1')).toBeNull()
  })

  it('file-pick clears input value after selection', async () => {
    const file = new File([new Uint8Array([1])], 'test.png', { type: 'image/png' })
    mockFileReader()

    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)

    const input = screen.getByTestId('file-input') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file], configurable: true })

    fireEvent.change(input)

    await waitFor(() => expect(screen.getByTestId('attachment-strip')).toBeTruthy())
    expect(input.value).toBe('')
  })

  it('thumbnail renders with blob objectUrl as img src', async () => {
    const fakeFile = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' })
    mockFileReader()

    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)

    const dt = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => fakeFile }],
    }
    fireEvent(screen.getByTestId('message-textarea'), Object.assign(new Event('paste', { bubbles: true }), { clipboardData: dt }))

    await waitFor(() => expect(screen.getByTestId('attachment-strip')).toBeTruthy())

    const img = screen.getByAltText('attachment 1') as HTMLImageElement
    expect(img.src).toContain('blob:mock-')
    expect(createdUrls.some((url) => img.src.includes(url))).toBe(true)
  })

  it('thumbnail shows correct alt text for each attachment', async () => {
    const file1 = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
    const file2 = new File([new Uint8Array([2])], 'b.png', { type: 'image/png' })
    mockFileReader()

    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)

    const dt = {
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => file1 },
        { kind: 'file', type: 'image/png', getAsFile: () => file2 },
      ],
    }
    fireEvent(screen.getByTestId('message-textarea'), Object.assign(new Event('paste', { bubbles: true }), { clipboardData: dt }))

    await waitFor(() => expect(screen.getByTestId('attachment-strip')).toBeTruthy())

    expect(screen.getByAltText('attachment 1')).toBeTruthy()
    expect(screen.getByAltText('attachment 2')).toBeTruthy()
  })

  it('handles large file without crashing', async () => {
    const largeArray = new Uint8Array(10 * 1024 * 1024)
    const largeFile = new File([largeArray], 'big.png', { type: 'image/png' })
    mockFileReader()

    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)

    const input = screen.getByTestId('file-input') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [largeFile], configurable: true })

    fireEvent.change(input)

    await waitFor(() => expect(screen.getByTestId('attachment-strip')).toBeTruthy())
    expect(screen.getByTestId('remove-attachment-0')).toBeTruthy()
  })

  it('sends images with text when onSend is called', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    const fakeFile = new File([new Uint8Array([1, 2, 3])], 'img.png', { type: 'image/png' })
    mockFileReader()

    render(<Controlled onSend={onSend} />)

    const dt = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => fakeFile }],
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

  it('remove button dismisses an attachment and revokes URL', async () => {
    const fakeFile = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' })
    mockFileReader()

    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)

    const dt = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => fakeFile }],
    }
    const textarea = screen.getByTestId('message-textarea')
    fireEvent(textarea, Object.assign(new Event('paste', { bubbles: true }), { clipboardData: dt }))

    await waitFor(() => expect(screen.getByTestId('remove-attachment-0')).toBeTruthy())

    const urlsBefore = createdUrls.length
    fireEvent.click(screen.getByTestId('remove-attachment-0'))

    await waitFor(() => expect(screen.queryByTestId('attachment-strip')).toBeNull())
    expect(revokedUrls.length).toBe(urlsBefore)
  })

  it('revokes all attachment URLs after successful send', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    const file1 = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
    const file2 = new File([new Uint8Array([2])], 'b.png', { type: 'image/png' })
    mockFileReader()

    render(<Controlled onSend={onSend} />)

    const dt = {
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => file1 },
        { kind: 'file', type: 'image/png', getAsFile: () => file2 },
      ],
    }
    const textarea = screen.getByTestId('message-textarea')
    fireEvent(textarea, Object.assign(new Event('paste', { bubbles: true }), { clipboardData: dt }))

    await waitFor(() => expect(screen.getByTestId('attachment-strip')).toBeTruthy())

    const urlsCreated = createdUrls.length

    fireEvent.input(textarea, { target: { value: 'sending both' } })
    fireEvent.click(screen.getByTestId('send-btn'))

    await waitFor(() => expect(onSend).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('attachment-strip')).toBeNull())

    expect(revokedUrls.length).toBe(urlsCreated)
  })

  it('does not revoke URLs if send fails', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('network error'))
    const fakeFile = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' })
    mockFileReader()

    render(<Controlled onSend={onSend} />)

    const dt = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => fakeFile }],
    }
    const textarea = screen.getByTestId('message-textarea')
    fireEvent(textarea, Object.assign(new Event('paste', { bubbles: true }), { clipboardData: dt }))

    await waitFor(() => expect(screen.getByTestId('attachment-strip')).toBeTruthy())

    revokedUrls = []

    fireEvent.input(textarea, { target: { value: 'will fail' } })
    fireEvent.click(screen.getByTestId('send-btn'))

    await waitFor(() => expect(screen.getByText(/Send failed/)).toBeTruthy())

    expect(revokedUrls.length).toBe(0)
    expect(screen.getByTestId('attachment-strip')).toBeTruthy()
  })

  it('accepts all valid image types: png, jpeg, gif, webp', async () => {
    const pngFile = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
    const jpegFile = new File([new Uint8Array([2])], 'b.jpeg', { type: 'image/jpeg' })
    const gifFile = new File([new Uint8Array([3])], 'c.gif', { type: 'image/gif' })
    const webpFile = new File([new Uint8Array([4])], 'd.webp', { type: 'image/webp' })
    mockFileReader()

    render(<Controlled onSend={vi.fn().mockResolvedValue(undefined)} />)

    const input = screen.getByTestId('file-input') as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [pngFile, jpegFile, gifFile, webpFile],
      configurable: true,
    })

    fireEvent.change(input)

    await waitFor(() => expect(screen.getByTestId('attachment-strip')).toBeTruthy())
    expect(screen.getByTestId('remove-attachment-0')).toBeTruthy()
    expect(screen.getByTestId('remove-attachment-1')).toBeTruthy()
    expect(screen.getByTestId('remove-attachment-2')).toBeTruthy()
    expect(screen.getByTestId('remove-attachment-3')).toBeTruthy()
  })
})
