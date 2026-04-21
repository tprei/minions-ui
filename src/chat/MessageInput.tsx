import { useRef, useCallback, useState } from 'preact/hooks'
import type { ApiSession } from '../api/types'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'

const PLACEHOLDER = 'Send instructions to the agent — Enter to send, Shift+Enter for newline'

export interface ImageAttachment {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  dataBase64: string
  objectUrl: string
}

interface MessageInputProps {
  session: ApiSession
  value: string
  onValueChange: (text: string) => void
  onSend: (text: string, images?: Array<{ mediaType: string; dataBase64: string }>) => Promise<void>
}

const VALID_IMAGE_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function readFileAsBase64(file: File): Promise<{ mediaType: string; dataBase64: string; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const comma = result.indexOf(',')
      if (comma === -1) { reject(new Error('Invalid data URL')); return }
      const dataBase64 = result.slice(comma + 1)
      const objectUrl = URL.createObjectURL(file)
      resolve({ mediaType: file.type, dataBase64, objectUrl })
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(file)
  })
}

export function MessageInput({ value, onValueChange, onSend }: MessageInputProps) {
  const [sending, setSending] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const pendingRef = useRef<{ text: string; images: ImageAttachment[] } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const baseTextRef = useRef('')
  const valueRef = useRef(value)
  valueRef.current = value

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = 20
    const maxLines = 8
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * maxLines)}px`
  }, [])

  const handleFinal = useCallback(
    (transcript: string) => {
      const base = baseTextRef.current
      const sep = base && !/\s$/.test(base) ? ' ' : ''
      const next = `${base}${sep}${transcript.trim()}`
      baseTextRef.current = next
      onValueChange(next)
      requestAnimationFrame(adjustHeight)
    },
    [onValueChange, adjustHeight],
  )

  const handleInterim = useCallback(
    (interim: string) => {
      const base = baseTextRef.current
      const sep = base && !/\s$/.test(base) ? ' ' : ''
      onValueChange(`${base}${sep}${interim}`)
      requestAnimationFrame(adjustHeight)
    },
    [onValueChange, adjustHeight],
  )

  const handleVoiceError = useCallback((message: string) => {
    setErrorText(message)
  }, [])

  const {
    supported: micSupported,
    recording,
    start: startRecording,
    stop: stopRecording,
  } = useSpeechRecognition({
    onFinal: handleFinal,
    onInterim: handleInterim,
    onError: handleVoiceError,
  })

  const addFiles = useCallback(async (files: File[]) => {
    const valid = files.filter((f) => VALID_IMAGE_TYPES.has(f.type))
    if (valid.length === 0) return
    const results = await Promise.all(valid.map(readFileAsBase64))
    setAttachments((prev) => [
      ...prev,
      ...results.map((r) => ({
        mediaType: r.mediaType as ImageAttachment['mediaType'],
        dataBase64: r.dataBase64,
        objectUrl: r.objectUrl,
      })),
    ])
  }, [])

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageItems: File[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (!item) continue
        if (item.kind === 'file' && VALID_IMAGE_TYPES.has(item.type)) {
          const file = item.getAsFile()
          if (file) imageItems.push(file)
        }
      }
      if (imageItems.length > 0) {
        e.preventDefault()
        void addFiles(imageItems)
      }
    },
    [addFiles],
  )

  const handleFileChange = useCallback(
    (e: Event) => {
      const input = e.target as HTMLInputElement
      if (!input.files) return
      void addFiles(Array.from(input.files))
      input.value = ''
    },
    [addFiles],
  )

  const removeAttachment = useCallback((idx: number) => {
    setAttachments((prev) => {
      const next = [...prev]
      const removed = next.splice(idx, 1)
      for (const r of removed) URL.revokeObjectURL(r.objectUrl)
      return next
    })
  }, [])

  const submit = useCallback(
    async (text: string, currentAttachments: ImageAttachment[]) => {
      const trimmed = text.trim()
      if (!trimmed || sending) return
      pendingRef.current = { text: trimmed, images: currentAttachments }
      setErrorText(null)
      setSending(true)
      try {
        const images =
          currentAttachments.length > 0
            ? currentAttachments.map((a) => ({ mediaType: a.mediaType, dataBase64: a.dataBase64 }))
            : undefined
        await onSend(trimmed, images)
        onValueChange('')
        for (const a of currentAttachments) URL.revokeObjectURL(a.objectUrl)
        setAttachments([])
        pendingRef.current = null
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
        }
      } catch {
        setErrorText('Send failed — retry')
      } finally {
        setSending(false)
      }
    },
    [sending, onSend, onValueChange],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void submit(value, attachments)
      }
    },
    [value, attachments, submit],
  )

  const handleInput = useCallback(
    (e: Event) => {
      const next = (e.target as HTMLTextAreaElement).value
      onValueChange(next)
      if (!recording) baseTextRef.current = next
      adjustHeight()
    },
    [onValueChange, adjustHeight, recording],
  )

  const handleMicClick = useCallback(() => {
    if (recording) {
      stopRecording()
      return
    }
    setErrorText(null)
    baseTextRef.current = valueRef.current
    startRecording()
  }, [recording, startRecording, stopRecording])

  const handleRetry = useCallback(() => {
    const saved = pendingRef.current
    if (saved) {
      setErrorText(null)
      void submit(saved.text, saved.images)
    }
  }, [submit])

  const trimmed = value.trim()
  const charCount = trimmed.length
  const isSlash = trimmed.startsWith('/')

  return (
    <div
      class="px-3 sm:px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 flex flex-col gap-2 bg-white dark:bg-slate-800"
      data-testid="composer"
    >
      {errorText && (
        <div class="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <span>{errorText}</span>
          {pendingRef.current && (
            <button
              type="button"
              onClick={handleRetry}
              class="underline font-medium"
              data-testid="retry-btn"
            >
              Retry
            </button>
          )}
        </div>
      )}
      <ComposerToolbar
        charCount={charCount}
        isSlash={isSlash}
        sending={sending}
        recording={recording}
      />
      {attachments.length > 0 && (
        <div class="flex flex-wrap gap-2" data-testid="attachment-strip">
          {attachments.map((a, idx) => (
            <div
              key={a.objectUrl}
              class="relative w-16 h-16 rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 flex-shrink-0"
            >
              <img
                src={a.objectUrl}
                alt={`attachment ${idx + 1}`}
                class="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeAttachment(idx)}
                class="absolute top-0 right-0 w-5 h-5 flex items-center justify-center bg-black/60 text-white text-[10px] rounded-bl"
                aria-label={`Remove attachment ${idx + 1}`}
                data-testid={`remove-attachment-${idx}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div class="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          onChange={handleFileChange}
          data-testid="file-input"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          aria-label="Attach image"
          title="Attach image"
          class="shrink-0 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors border shadow-sm disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600"
          data-testid="attach-btn"
        >
          <PaperclipIcon />
        </button>
        <textarea
          ref={textareaRef}
          value={value}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={sending}
          placeholder={PLACEHOLDER}
          rows={1}
          class="flex-1 resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 overflow-y-auto"
          style={{ minHeight: '40px', maxHeight: '160px' }}
          data-testid="message-textarea"
        />
        {micSupported && (
          <button
            type="button"
            onClick={handleMicClick}
            disabled={sending}
            aria-pressed={recording}
            aria-label={recording ? 'Stop voice input' : 'Start voice input'}
            title={recording ? 'Stop voice input' : 'Start voice input'}
            class={`shrink-0 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors border shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
              recording
                ? 'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white border-red-600'
                : 'bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600'
            }`}
            data-testid="mic-btn"
          >
            <MicIcon recording={recording} />
          </button>
        )}
        <button
          type="button"
          onClick={() => void submit(value, attachments)}
          disabled={sending || (!trimmed && attachments.length === 0)}
          class="shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors text-white shadow-sm bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="send-btn"
          aria-label={sending ? 'Sending' : 'Send'}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

function ComposerToolbar({
  charCount,
  isSlash,
  sending,
  recording,
}: {
  charCount: number
  isSlash: boolean
  sending: boolean
  recording: boolean
}) {
  return (
    <div
      class="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400"
      data-testid="composer-toolbar"
    >
      <Kbd>Enter</Kbd>
      <span>send</span>
      <span class="opacity-40">·</span>
      <Kbd>Shift</Kbd>
      <span>+</span>
      <Kbd>Enter</Kbd>
      <span>newline</span>
      {isSlash && (
        <span
          class="ml-2 inline-flex items-center gap-1 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 font-mono"
          data-testid="composer-slash-indicator"
        >
          slash command
        </span>
      )}
      <span class="ml-auto flex items-center gap-1.5">
        {recording && (
          <span
            class="inline-flex items-center gap-1 text-red-600 dark:text-red-400"
            data-testid="composer-recording-indicator"
          >
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            listening
          </span>
        )}
        {sending && (
          <span class="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-300">
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
            sending
          </span>
        )}
        {charCount > 0 && (
          <span class="font-mono" data-testid="composer-char-count">
            {charCount}
          </span>
        )}
      </span>
    </div>
  )
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd class="rounded border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 px-1 py-px font-mono text-[10px] text-slate-600 dark:text-slate-300">
      {children}
    </kbd>
  )
}

function MicIcon({ recording }: { recording: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4" aria-hidden="true">
      <path d="M10 2a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M5 10a1 1 0 0 1 2 0 3 3 0 0 0 6 0 1 1 0 1 1 2 0 5 5 0 0 1-4 4.9V17h2a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2h2v-2.1A5 5 0 0 1 5 10Z" />
      {recording && <circle cx="16" cy="4" r="2" fill="#ef4444" />}
    </svg>
  )
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a1.5 1.5 0 0 0 2.122 2.122l6.5-6.5a.75.75 0 0 1 1.06 1.06l-6.5 6.5a3 3 0 0 1-4.242-4.243l7-7a4.5 4.5 0 0 1 6.364 6.364l-7 7a6 6 0 0 1-8.485-8.486l5.5-5.5a.75.75 0 0 1 1.06 1.061l-5.5 5.5a4.5 4.5 0 0 0 6.365 6.364l7-7a3 3 0 0 0 0-4.243Z"
        clipRule="evenodd"
      />
    </svg>
  )
}
