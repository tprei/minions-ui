import { useEffect } from 'preact/hooks'

export interface ShortcutEntry {
  keys: string[]
  description: string
}

export interface ShortcutSection {
  title: string
  entries: ShortcutEntry[]
}

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'Global',
    entries: [
      { keys: ['⌘', 'K'], description: 'Open command palette' },
      { keys: ['Ctrl', 'K'], description: 'Open command palette (Linux/Windows)' },
      { keys: ['?'], description: 'Show this shortcuts help' },
      { keys: ['n'], description: 'New task — focus the task bar' },
      { keys: ['r'], description: 'Refresh sessions and DAGs' },
      { keys: ['Esc'], description: 'Close any open overlay' },
    ],
  },
  {
    title: 'Navigation',
    entries: [
      { keys: ['g', 'l'], description: 'Go to sessions list' },
      { keys: ['g', 'c'], description: 'Go to canvas' },
      { keys: ['g', 's'], description: 'Go to ship pipeline' },
      { keys: ['g', 'k'], description: 'Go to kanban' },
    ],
  },
  {
    title: 'Command palette',
    entries: [
      { keys: ['↑', '↓'], description: 'Move selection' },
      { keys: ['↵'], description: 'Run selected command' },
      { keys: ['Esc'], description: 'Close palette' },
    ],
  },
  {
    title: 'Task bar',
    entries: [
      { keys: ['⌘', '↵'], description: 'Submit task (when prompt focused)' },
      { keys: ['Ctrl', '↵'], description: 'Submit task (Linux/Windows)' },
    ],
  },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function KeyboardShortcutsHelp({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kbd-help-title"
      data-testid="keyboard-shortcuts-help"
    >
      <div
        class="absolute inset-0 bg-black/50"
        onClick={onClose}
        data-testid="keyboard-shortcuts-backdrop"
      />
      <div class="relative z-10 w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl flex flex-col overflow-hidden max-h-[80vh]">
        <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2 id="kbd-help-title" class="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            class="rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1 text-xs"
            aria-label="Close keyboard shortcuts help"
            data-testid="keyboard-shortcuts-close"
          >
            ✕
          </button>
        </div>
        <div class="overflow-y-auto px-4 py-3 flex flex-col gap-4">
          {SHORTCUT_SECTIONS.map((section) => (
            <section key={section.title} aria-labelledby={`kbd-section-${section.title}`}>
              <h3
                id={`kbd-section-${section.title}`}
                class="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5"
              >
                {section.title}
              </h3>
              <ul class="flex flex-col gap-1.5">
                {section.entries.map((entry, idx) => (
                  <li
                    key={`${section.title}-${idx}`}
                    class="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200"
                    data-testid={`shortcut-entry-${section.title}-${idx}`}
                  >
                    <span class="flex-1 min-w-0">{entry.description}</span>
                    <span class="shrink-0 flex items-center gap-1">
                      {entry.keys.map((k, kidx) => (
                        <kbd
                          key={kidx}
                          class="text-[11px] font-mono text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 bg-slate-50 dark:bg-slate-900"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div class="px-4 py-2 border-t border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 dark:text-slate-400">
          Press <kbd class="border border-slate-200 dark:border-slate-700 rounded px-1 font-mono">?</kbd> to toggle, <kbd class="border border-slate-200 dark:border-slate-700 rounded px-1 font-mono">Esc</kbd> to close.
        </div>
      </div>
    </div>
  )
}
