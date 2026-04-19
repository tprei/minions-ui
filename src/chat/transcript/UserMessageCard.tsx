import type { UserMessageEvent } from '../../api/types'

interface Props {
  event: UserMessageEvent
}

export function UserMessageCard({ event }: Props) {
  const hasImages = event.images && event.images.length > 0
  return (
    <div class="group flex gap-3 justify-end" data-testid="transcript-user-message">
      <div class="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-slate-900 dark:bg-slate-700 text-slate-100 whitespace-pre-wrap break-words font-mono">
        {event.text}
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
