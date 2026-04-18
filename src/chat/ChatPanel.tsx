import { useEffect, useRef, useCallback } from 'preact/hooks'
import type { ApiSession } from '../api/types'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useTheme } from '../hooks/useTheme'
import { ConversationView } from './ConversationView'
import { QuickActionsBar } from './QuickActionsBar'
import { MessageInput } from './MessageInput'
import type { QuickAction } from '../api/types'

interface ChatPanelProps {
  session: ApiSession
  onClose: () => void
  onSend: (text: string, sessionId: string) => Promise<void>
  sseStatus?: string
}

export function ChatPanel({ session, onClose, onSend, sseStatus }: ChatPanelProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const inputWrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<Element | null>(null)
  const touchStartYRef = useRef<number | null>(null)

  useEffect(() => {
    triggerRef.current = document.activeElement
    const inputEl = inputWrapRef.current?.querySelector('textarea')
    inputEl?.focus()
    return () => {
      const el = triggerRef.current
      if (el && 'focus' in el) {
        (el as HTMLElement).focus()
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleBackdropClick = useCallback(() => {
    if (!isDesktop.value) onClose()
  }, [isDesktop, onClose])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY
  }, [])

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (touchStartYRef.current === null) return
      const deltaY = e.touches[0].clientY - touchStartYRef.current
      if (deltaY > 80) {
        touchStartYRef.current = null
        onClose()
      }
    },
    [onClose]
  )

  const handleTouchEnd = useCallback(() => {
    touchStartYRef.current = null
  }, [])

  const handleSend = useCallback(
    (text: string) => onSend(text, session.id),
    [onSend, session.id]
  )

  const handleQuickAction = useCallback(
    (action: QuickAction) => onSend(action.message, session.id),
    [onSend, session.id]
  )

  const panelBg = isDark ? 'bg-gray-800' : 'bg-white'
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200'
  const titleColor = isDark ? 'text-white' : 'text-gray-900'

  const isLive = sseStatus === 'live'

  if (isDesktop.value) {
    return (
      <div
        class={`fixed inset-y-0 right-0 z-50 flex flex-col w-full max-w-md border-l shadow-2xl ${panelBg} ${borderColor}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Chat: ${session.slug}`}
      >
        <header class={`flex items-center gap-2 px-4 py-3 border-b shrink-0 ${borderColor}`}>
          <span class={`flex-1 font-semibold text-sm ${titleColor} truncate`}>{session.slug}</span>
          {!isLive && sseStatus && (
            <span class="text-xs text-yellow-500" data-testid="reconnecting-badge">Reconnecting…</span>
          )}
          <button
            onClick={onClose}
            class={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
            aria-label="Close chat"
            data-testid="chat-close-btn"
          >
            <span class="text-lg leading-none">&times;</span>
          </button>
        </header>
        <ConversationView messages={session.conversation} />
        <div class="shrink-0" ref={inputWrapRef}>
          <QuickActionsBar actions={session.quickActions} onAction={handleQuickAction} />
          <MessageInput session={session} onSend={handleSend} />
        </div>
      </div>
    )
  }

  return (
    <div class="fixed inset-0 z-50">
      <div
        class="absolute inset-0 bg-black/50"
        onClick={handleBackdropClick}
      />
      <div
        class={`absolute bottom-0 left-0 right-0 flex flex-col rounded-t-2xl shadow-2xl ${panelBg}`}
        style={{ maxHeight: '85vh' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        role="dialog"
        aria-modal="true"
        aria-label={`Chat: ${session.slug}`}
      >
        <div class="flex justify-center pt-2 pb-1 shrink-0">
          <div class={`w-10 h-1 rounded-full ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`} />
        </div>
        <header class={`flex items-center gap-2 px-4 py-2 border-b shrink-0 ${borderColor}`}>
          <span class={`flex-1 font-semibold text-sm ${titleColor} truncate`}>{session.slug}</span>
          {!isLive && sseStatus && (
            <span class="text-xs text-yellow-500" data-testid="reconnecting-badge">Reconnecting…</span>
          )}
          <button
            onClick={onClose}
            class={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
            aria-label="Close chat"
            data-testid="chat-close-btn"
          >
            <span class="text-lg leading-none">&times;</span>
          </button>
        </header>
        <ConversationView messages={session.conversation} />
        <div class="shrink-0" ref={inputWrapRef}>
          <QuickActionsBar actions={session.quickActions} onAction={handleQuickAction} />
          <MessageInput session={session} onSend={handleSend} />
        </div>
      </div>
    </div>
  )
}
