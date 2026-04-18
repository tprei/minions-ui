import { useEffect, useRef } from 'preact/hooks'
import type { ConversationMessage } from '../api/types'
import { useTheme } from '../hooks/useTheme'

interface ConversationViewProps {
  messages: ConversationMessage[]
}

export function ConversationView({ messages }: ConversationViewProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevLengthRef = useRef(messages.length)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const prevLen = prevLengthRef.current
    prevLengthRef.current = messages.length
    if (messages.length <= prevLen) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80
    if (nearBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length])

  return (
    <div
      ref={scrollRef}
      class="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3"
      data-testid="conversation-view"
    >
      {messages.map((msg, idx) => {
        const isUser = msg.role === 'user'
        const bubbleBg = isUser
          ? isDark ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white'
          : isDark ? 'bg-gray-700 text-gray-100' : 'bg-gray-100 text-gray-900'
        return (
          <div
            key={idx}
            class={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
            data-testid={`message-${msg.role}`}
          >
            <div
              class={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${bubbleBg}`}
            >
              {msg.text}
            </div>
          </div>
        )
      })}
    </div>
  )
}
