import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ConversationMessage } from '../api/types'
import { MarkdownView } from '../components/MarkdownView'
import { isOrchestratorStatus } from './orchestrator-filter'

interface ConversationViewProps {
  messages: ConversationMessage[]
}

function AssistantMessage({ text }: { text: string }) {
  return (
    <div class="group flex gap-3 justify-start" data-testid="message-assistant">
      <div class="shrink-0 mt-1 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
        M
      </div>
      <MarkdownView
        source={text}
        class="flex-1 min-w-0 prose prose-sm dark:prose-invert max-w-none prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-pre:rounded-lg prose-pre:px-3 prose-pre:py-2 prose-pre:text-xs prose-code:before:content-none prose-code:after:content-none prose-code:bg-slate-100 dark:prose-code:bg-slate-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded text-slate-800 dark:text-slate-200"
      />
    </div>
  )
}

function UserMessage({ text }: { text: string }) {
  return (
    <div class="group flex gap-3 justify-end" data-testid="message-user">
      <div class="max-w-[80%] rounded-lg px-3 py-2 text-sm font-mono bg-slate-900 dark:bg-slate-700 text-slate-100 whitespace-pre-wrap break-words">
        {text}
      </div>
    </div>
  )
}

const NEAR_BOTTOM_PX = 120

export function ConversationView({ messages }: ConversationViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  const visible = useMemo(
    () => messages.filter((m) => !(m.role === 'assistant' && isOrchestratorStatus(m.text))),
    [messages],
  )
  const prevLengthRef = useRef(visible.length)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const prevLen = prevLengthRef.current
    prevLengthRef.current = visible.length
    if (visible.length <= prevLen) return
    if (following) el.scrollTop = el.scrollHeight
  }, [visible.length, following])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_BOTTOM_PX
    if (nearBottom !== following) setFollowing(nearBottom)
  }

  function jumpToLatest() {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setFollowing(true)
  }

  return (
    <div class="relative flex-1 flex min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        class="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 bg-slate-50 dark:bg-slate-900"
        data-testid="conversation-view"
      >
        {visible.length === 0 && (
          <div class="text-xs text-slate-500 dark:text-slate-400 italic text-center py-8">
            No messages yet.
          </div>
        )}
        {visible.map((msg, idx) =>
          msg.role === 'assistant' ? (
            <AssistantMessage key={idx} text={msg.text} />
          ) : (
            <UserMessage key={idx} text={msg.text} />
          )
        )}
      </div>
      {!following && visible.length > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          data-testid="jump-to-latest"
          aria-label="Jump to latest messages"
          class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 shadow-md hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5" aria-hidden="true">
            <path fill-rule="evenodd" d="M10 3a.75.75 0 0 1 .75.75v10.69l3.72-3.72a.75.75 0 1 1 1.06 1.06l-5 5a.75.75 0 0 1-1.06 0l-5-5a.75.75 0 1 1 1.06-1.06l3.72 3.72V3.75A.75.75 0 0 1 10 3Z" clip-rule="evenodd" />
          </svg>
          Jump to latest
        </button>
      )}
    </div>
  )
}
