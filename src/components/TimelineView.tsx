import { useEffect } from 'preact/hooks'
import type { ApiDagGraph, ApiSession } from '../api/types'
import type { ConnectionStore } from '../state/types'
import { SessionList } from './SessionList'
import { TimelineLog } from './TimelineLog'

export interface TimelineViewProps {
  store: ConnectionStore
  sessions: ApiSession[]
  dags: ApiDagGraph[]
  sessionId: string | null
  onSelect: (id: string) => void
  isDesktop: boolean
}

export function TimelineView({
  store,
  sessions,
  dags,
  sessionId,
  onSelect,
  isDesktop,
}: TimelineViewProps) {
  const selected = sessionId ? sessions.find((s) => s.id === sessionId) ?? null : null
  const transcript = selected ? store.getTranscript(selected.id) : null

  useEffect(() => {
    if (!transcript) return
    void transcript.reconcile()
  }, [transcript])

  return (
    <div
      class="flex flex-1 min-h-0"
      data-testid="timeline-view"
      style={{ flexDirection: isDesktop ? 'row' : 'column' }}
    >
      {isDesktop ? (
        <aside
          class="border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 overflow-y-auto shrink-0 w-72"
          data-testid="timeline-sidebar"
        >
          <SessionList
            sessions={sessions}
            dags={dags}
            activeSessionId={sessionId}
            onSelect={onSelect}
            orientation="vertical"
          />
        </aside>
      ) : (
        sessions.length > 0 && (
          <div data-testid="timeline-strip" class="shrink-0">
            <SessionList
              sessions={sessions}
              dags={dags}
              activeSessionId={sessionId}
              onSelect={onSelect}
              orientation="horizontal"
            />
          </div>
        )
      )}
      <div class="flex flex-col flex-1 min-h-0">
        {selected && transcript ? (
          <>
            <div
              class="flex items-center gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0"
              data-testid="timeline-session-header"
            >
              <span class="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {selected.slug}
              </span>
              {selected.command && (
                <span class="text-xs text-slate-500 dark:text-slate-400 truncate">
                  · {selected.command}
                </span>
              )}
            </div>
            <TimelineLog transcript={transcript} testIdPrefix="timeline" />
          </>
        ) : (
          <div
            class="flex-1 flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-900"
            data-testid="timeline-empty"
          >
            <div class="text-sm text-slate-500 dark:text-slate-400 text-center">
              {sessions.length === 0
                ? 'No sessions yet — start one to see its timeline.'
                : 'Select a session to view its timeline.'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
