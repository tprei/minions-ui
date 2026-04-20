import type { UserMessageEvent } from '../../api/types'
import { MarkdownView } from '../../components/MarkdownView'

interface Props {
  event: UserMessageEvent
}

export function UserMessageCard({ event }: Props) {
  const hasImages = event.images && event.images.length > 0
  return (
    <div class="group flex gap-3 justify-end" data-testid="transcript-user-message">
      <div class="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-slate-900 dark:bg-slate-700 text-slate-100">
        <MarkdownView
          source={event.text}
          class="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-pre:bg-slate-950 prose-pre:text-slate-100 prose-pre:rounded-md prose-pre:px-2 prose-pre:py-1.5 prose-pre:text-xs prose-code:before:content-none prose-code:after:content-none prose-code:bg-slate-800 prose-code:text-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-headings:text-slate-100 prose-headings:my-1 prose-a:text-indigo-300 text-slate-100"
        />
        {hasImages && (
          <div class="mt-2 flex flex-wrap gap-1.5">
            {event.images!.map((url, i) => (
              <span
                key={i}
                class="inline-flex items-center gap-1 rounded bg-slate-800 dark:bg-slate-600 px-1.5 py-0.5 text-[10px] font-mono text-slate-300"
                title={url}
              >
                image {i + 1}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
