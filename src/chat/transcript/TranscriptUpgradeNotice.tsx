import type { ConnectionStore } from '../../state/types'

export const MIN_LIBRARY_VERSION = '1.119'

export interface TranscriptUpgradeNoticeProps {
  store: ConnectionStore
}

export function TranscriptUpgradeNotice({ store }: TranscriptUpgradeNoticeProps) {
  const version = store.version.value
  const running = version?.libraryVersion ?? 'unknown'
  return (
    <div
      class="flex-1 flex items-center justify-center px-6 py-10 bg-slate-50 dark:bg-slate-900"
      data-testid="transcript-upgrade-notice"
    >
      <div class="max-w-md text-center space-y-3">
        <div class="mx-auto h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
          <svg
            class="h-5 w-5 text-amber-700 dark:text-amber-300"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fill-rule="evenodd"
              d="M8.485 2.495a1.75 1.75 0 013.03 0l6.25 10.833A1.75 1.75 0 0116.25 16H3.75a1.75 1.75 0 01-1.515-2.672l6.25-10.833zM10 7a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 0110 7zm0 6a.875.875 0 100 1.75.875.875 0 000-1.75z"
              clip-rule="evenodd"
            />
          </svg>
        </div>
        <h2 class="text-sm font-semibold text-slate-900 dark:text-slate-100">
          This minion needs a library update
        </h2>
        <p class="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          The conductor-style chat view needs{' '}
          <code class="font-mono text-slate-800 dark:text-slate-200">
            @tprei/telegram-minions ≥ {MIN_LIBRARY_VERSION}
          </code>
          . This minion reports{' '}
          <code class="font-mono text-slate-800 dark:text-slate-200">{running}</code>.
        </p>
        <p class="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          Redeploy with the latest image (
          <code class="font-mono text-slate-800 dark:text-slate-200">fly deploy</code>) to
          unlock live tool calls, streaming text, and structured status.
        </p>
      </div>
    </div>
  )
}
