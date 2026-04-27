import { useEffect } from 'preact/hooks'

export interface HelpSection {
  id: string
  icon: string
  title: string
  body: string
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'new-task',
    icon: '✨',
    title: 'New task bar',
    body: 'The bar at the top spawns a new minion. Type a task and press enter; the minion runs autonomously until it ships a PR or asks for input.',
  },
  {
    id: 'sessions',
    icon: '📋',
    title: 'Sessions',
    body: 'A session is one minion working on one task. The list (or strip on mobile) shows status, slug, and quick attention reasons.',
  },
  {
    id: 'attention',
    icon: '🔔',
    title: 'Attention pills',
    body: 'When sessions need you (failed, waiting for feedback, finished), pills appear above the list. Click a pill to filter to those sessions.',
  },
  {
    id: 'list-view',
    icon: '☰',
    title: 'List view',
    body: 'Sidebar of sessions plus a chat pane on the right. The default view — best for replying to a single minion.',
  },
  {
    id: 'kanban-view',
    icon: '📋',
    title: 'Kanban view',
    body: 'Group sessions by status (running, waiting, done, failed). Best for triaging many minions at once.',
  },
  {
    id: 'canvas-view',
    icon: '◎',
    title: 'Canvas view',
    body: 'Spatial DAG of sessions and their parents/children. Pan, zoom, and long-press / right-click any node for actions.',
  },
  {
    id: 'ship-view',
    icon: '🚀',
    title: 'Ship view',
    body: 'Pipeline grouping every DAG by stage: plan → implement → review → land. Failed nodes surface with a retry action.',
  },
  {
    id: 'long-press',
    icon: '🖐️',
    title: 'Long-press / right-click menu',
    body: 'On Canvas, long-press (mobile) or right-click (desktop) any node to stop, close, retry rebase, or jump straight to its chat.',
  },
  {
    id: 'quick-actions',
    icon: '⚡',
    title: 'Quick actions',
    body: 'Inside a session, the action bar surfaces the minion’s suggested next steps (e.g. approve plan, retry failed step, view PR).',
  },
  {
    id: 'slash-commands',
    icon: '/',
    title: 'Slash commands',
    body: 'In the message input, type / to see available commands like /clean, /memory, /restart, or any custom commands the minion advertises.',
  },
  {
    id: 'pull-refresh',
    icon: '⤓',
    title: 'Pull-to-refresh (mobile)',
    body: 'On mobile, drag down at the top of the list to refetch sessions and DAGs from the minion.',
  },
  {
    id: 'connections',
    icon: '🔌',
    title: 'Connections',
    body: 'Connect to multiple minion deployments and switch between them via the picker on the left of the header. Each gets its own accent color.',
  },
]

interface Props {
  open: boolean
  onClose: () => void
  onReplayTour: () => void
}

export function HelpPanel({ open, onClose, onReplayTour }: Props) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      class="fixed inset-0 z-[55] flex items-stretch justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-panel-title"
      data-testid="help-panel"
    >
      <div
        class="absolute inset-0 bg-black/40"
        onClick={onClose}
        data-testid="help-panel-overlay"
      />
      <div class="relative w-full sm:max-w-md h-[100dvh] bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <span aria-hidden="true" class="text-lg">❓</span>
          <h2
            id="help-panel-title"
            class="text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            Surface guide
          </h2>
          <button
            type="button"
            onClick={onClose}
            class="ml-auto rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-3 py-2 text-sm min-h-[44px]"
            aria-label="Close help panel"
            data-testid="help-panel-close"
          >
            Close
          </button>
        </div>
        <div class="flex-1 overflow-y-auto px-4 py-3">
          <p class="text-xs text-slate-500 dark:text-slate-400 mb-3">
            Quick reference for every surface in this UI. Tap “Replay tour” for the
            interactive walk-through.
          </p>
          <ul class="flex flex-col gap-3" data-testid="help-panel-sections">
            {HELP_SECTIONS.map((section) => (
              <li
                key={section.id}
                class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2.5"
                data-testid={`help-section-${section.id}`}
              >
                <div class="flex items-start gap-2">
                  <span class="text-lg leading-none mt-0.5" aria-hidden="true">
                    {section.icon}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {section.title}
                    </div>
                    <div class="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                      {section.body}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div class="border-t border-slate-200 dark:border-slate-700 px-4 py-3 shrink-0">
          <button
            type="button"
            onClick={onReplayTour}
            class="w-full rounded-md bg-indigo-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-indigo-700 min-h-[44px]"
            data-testid="help-panel-replay-tour"
          >
            Replay tour
          </button>
        </div>
      </div>
    </div>
  )
}
