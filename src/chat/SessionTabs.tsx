import type { ComponentChildren } from 'preact'

export type SessionTabId = 'chat' | 'diff' | 'screenshots' | 'checkpoints'

export interface SessionTabDef {
  id: SessionTabId
  label: string
  available: boolean
}

interface SessionTabsProps {
  tabs: SessionTabDef[]
  active: SessionTabId
  onChange: (id: SessionTabId) => void
  children: ComponentChildren
}

export function SessionTabs({ tabs, active, onChange, children }: SessionTabsProps) {
  const visible = tabs.filter((t) => t.available)
  return (
    <div class="flex flex-col flex-1 min-h-0">
      <div
        role="tablist"
        aria-label="Session views"
        class="flex items-center gap-1 px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0"
        data-testid="session-tabs"
      >
        {visible.map((t) => {
          const isActive = t.id === active
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`session-tab-panel-${t.id}`}
              id={`session-tab-${t.id}`}
              onClick={() => onChange(t.id)}
              class={
                'px-3 py-1 text-xs font-medium rounded-md transition-colors ' +
                (isActive
                  ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 border border-transparent')
              }
              data-testid={`session-tab-${t.id}`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={`session-tab-panel-${active}`}
        aria-labelledby={`session-tab-${active}`}
        class="flex flex-col flex-1 min-h-0"
      >
        {children}
      </div>
    </div>
  )
}
