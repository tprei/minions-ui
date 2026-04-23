import { useRef, useCallback, useState } from 'preact/hooks'
import type { ApiSession } from '../api/types'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { useImageAttachments, type ImageAttachment } from './ImageAttachments'

const PLACEHOLDER = 'Send instructions to the agent — Enter to send, Shift+Enter for newline'

interface MessageInputProps {
  session: ApiSession
  value: string
  onValueChange: (text: string) => void
  onSend: (text: string, images?: Array<{ mediaType: string; dataBase64: string }>) => Promise<void>
}

export function MessageInput({ value, onValueChange, onSend }: MessageInputProps) {
  const [sending, setSending] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const pendingRef = useRef<{ text: string; images: ImageAttachment[] } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const baseTextRef = useRef('')
  const valueRef = useRef(value)
  valueRef.current = value

  const { attachments, paperclipButton, attachmentsStrip, pasteHandler, clear } = useImageAttachments(sending)

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
        clear()
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
    [sending, onSend, onValueChange, clear],
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
      {attachmentsStrip}
      <div class="flex items-end gap-2">
        {paperclipButton}
        <textarea
          ref={textareaRef}
          value={value}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={pasteHandler}
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

