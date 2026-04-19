import { useRef, useCallback, useState } from 'preact/hooks'
import type { ApiSession } from '../api/types'

const PLACEHOLDER = 'Send instructions to the agent — Enter to send, Shift+Enter for newline'

interface MessageInputProps {
  session: ApiSession
  value: string
  onValueChange: (text: string) => void
  onSend: (text: string) => Promise<void>
}

export function MessageInput({ value, onValueChange, onSend }: MessageInputProps) {
  const [sending, setSending] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const pendingRef = useRef<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = 20
    const maxLines = 8
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * maxLines)}px`
  }, [])

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || sending) return
      pendingRef.current = trimmed
      setErrorText(null)
      setSending(true)
      try {
        await onSend(trimmed)
        onValueChange('')
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
        void submit(value)
      }
    },
    [value, submit],
  )

  const handleInput = useCallback(
    (e: Event) => {
      onValueChange((e.target as HTMLTextAreaElement).value)
      adjustHeight()
    },
    [onValueChange, adjustHeight],
  )

  const handleRetry = useCallback(() => {
    const saved = pendingRef.current
    if (saved) {
      setErrorText(null)
      void submit(saved)
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
          <button
            type="button"
            onClick={handleRetry}
            class="underline font-medium"
            data-testid="retry-btn"
          >
            Retry
          </button>
        </div>
      )}
      <ComposerToolbar charCount={charCount} isSlash={isSlash} sending={sending} />
      <div class="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          disabled={sending}
          placeholder={PLACEHOLDER}
          rows={1}
          class="flex-1 resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 overflow-y-auto"
          style={{ minHeight: '40px', maxHeight: '160px' }}
          data-testid="message-textarea"
        />
        <button
          type="button"
          onClick={() => void submit(value)}
          disabled={sending || !trimmed}
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
}: {
  charCount: number
  isSlash: boolean
  sending: boolean
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
