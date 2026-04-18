import { useState, useRef, useCallback } from 'preact/hooks'
import type { ApiSession } from '../api/types'
import { useTheme } from '../hooks/useTheme'

const PLACEHOLDER =
  'Message or /command — /task, /plan, /think, /stop, /close, /dag, /split, /stack, /ship, /doctor'

interface MessageInputProps {
  session: ApiSession
  onSend: (text: string) => Promise<void>
}

export function MessageInput({ onSend }: MessageInputProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const pendingRef = useRef<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = 20
    const maxLines = 6
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * maxLines)}px`
  }, [])

  const submit = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed || sending) return
      pendingRef.current = trimmed
      setErrorText(null)
      setSending(true)
      try {
        await onSend(trimmed)
        setText('')
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
    [sending, onSend]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void submit(text)
      }
    },
    [text, submit]
  )

  const handleInput = useCallback(
    (e: Event) => {
      setText((e.target as HTMLTextAreaElement).value)
      adjustHeight()
    },
    [adjustHeight]
  )

  const handleRetry = useCallback(() => {
    const saved = pendingRef.current
    if (saved) {
      setErrorText(null)
      void submit(saved)
    }
  }, [submit])

  const inputBg = isDark
    ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-500'
    : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'

  const sendBtnClass = isDark
    ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white'
    : 'bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white'

  return (
    <div
      class="px-4 py-3 border-t flex flex-col gap-2"
      style={{ borderColor: isDark ? '#374151' : '#e5e7eb' }}
    >
      {errorText && (
        <div class="flex items-center gap-2 text-xs text-red-500">
          <span>{errorText}</span>
          <button
            onClick={handleRetry}
            class="underline font-medium"
            data-testid="retry-btn"
          >
            Retry
          </button>
        </div>
      )}
      <div class="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          disabled={sending}
          placeholder={PLACEHOLDER}
          rows={1}
          class={`flex-1 resize-none rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 overflow-y-auto ${inputBg}`}
          style={{ minHeight: '40px', maxHeight: '120px' }}
          data-testid="message-textarea"
        />
        <button
          onClick={() => void submit(text)}
          disabled={sending || !text.trim()}
          class={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${sendBtnClass}`}
          data-testid="send-btn"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
