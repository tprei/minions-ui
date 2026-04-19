import type { AssistantTextEvent } from '../../api/types'
import { MarkdownView } from '../../components/MarkdownView'

interface Props {
  event: AssistantTextEvent
}

export function AssistantTextBlock({ event }: Props) {
  return (
    <div class="flex gap-3 justify-start" data-testid="transcript-assistant-text">
      <div class="shrink-0 mt-1 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
        M
      </div>
      <div class="flex-1 min-w-0">
        <MarkdownView
          source={event.text}
          class="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-pre:rounded-lg prose-pre:px-3 prose-pre:py-2 prose-pre:text-xs prose-code:before:content-none prose-code:after:content-none prose-code:bg-slate-100 dark:prose-code:bg-slate-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded text-slate-800 dark:text-slate-200"
        />
        {!event.final && (
          <span
            class="inline-block mt-1 align-middle h-2.5 w-2.5 rounded-full bg-indigo-500 animate-pulse"
            aria-label="Streaming"
            data-testid="transcript-streaming-indicator"
          />
        )}
      </div>
    </div>
  )
}
