import { useSignal } from '@preact/signals'
import { useEffect, useRef, useCallback } from 'preact/hooks'
import type { QuickAction, ApiSession, ShipStage } from '../api/types'
import { useTheme } from '../hooks/useTheme'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useSwipeToDismiss } from '../hooks/useSwipeToDismiss'
import { useHaptics } from '../hooks/useHaptics'

interface QuickActionsBarProps {
  session: ApiSession
  onAction: (action: QuickAction) => Promise<void>
  onShipAdvance?: (to: ShipStage) => Promise<void>
}

export function QuickActionsBar({ session, onAction, onShipAdvance }: QuickActionsBarProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const open = useSignal(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { vibrate } = useHaptics()

  const handleClose = useCallback(() => {
    open.value = false
  }, [open])

  const swipeRef = useSwipeToDismiss({
    onDismiss: handleClose,
    threshold: 100,
    enabled: !isDesktop.value,
  })

  useEffect(() => {
    if (!isDesktop.value && sheetRef.current) {
      swipeRef.current = sheetRef.current
    }
  }, [isDesktop.value, swipeRef])

  useEffect(() => {
    if (!open.value || isDesktop.value) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        open.value = false
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open.value, open, isDesktop.value])

  useEffect(() => {
    if (!open.value || !isDesktop.value) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        open.value = false
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open.value, open, isDesktop.value])

  if (session.mode === 'ship' && session.stage) {
    if (session.stage === 'done') return null

    const stageConfig = getShipStageConfig(session.stage, session.childIds.length)
    if (!stageConfig) return null

    const primaryClass = isDark
      ? 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-500'
      : 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-500'

    const disabledClass = isDark
      ? 'bg-gray-700 text-gray-400 border-gray-600 cursor-not-allowed'
      : 'bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed'

    const btnClass = stageConfig.disabled ? disabledClass : primaryClass

    return (
      <div
        class="flex flex-wrap gap-2 px-4 py-1.5 border-t"
        style={{ borderColor: isDark ? '#374151' : '#e5e7eb' }}
        data-testid="quick-actions-bar"
      >
        <button
          onClick={() => {
            if (!stageConfig.disabled && stageConfig.advanceTo && onShipAdvance) {
              void onShipAdvance(stageConfig.advanceTo)
            }
          }}
          disabled={stageConfig.disabled}
          class={`text-xs font-medium px-3.5 py-2 rounded-full border transition-colors min-h-[44px] ${btnClass}`}
          data-testid="ship-advance-btn"
        >
          {stageConfig.label}
        </button>
      </div>
    )
  }

  if (session.quickActions.length === 0) return null

  const btnClass = isDark
    ? 'bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-600'
    : 'bg-gray-100 hover:bg-gray-200 text-gray-800 border-gray-200'

  const handleActionClick = (action: QuickAction) => {
    vibrate('light')
    void onAction(action)
    if (open.value) {
      open.value = false
    }
  }

  const handleMoreClick = () => {
    vibrate('light')
    open.value = true
  }

  if (!isDesktop.value) {
    return (
      <>
        <div
          class="flex flex-wrap gap-2 px-4 py-1.5 border-t"
          style={{ borderColor: isDark ? '#374151' : '#e5e7eb' }}
          data-testid="quick-actions-bar"
        >
          <button
            onClick={handleMoreClick}
            class={`text-xs font-medium px-3.5 py-2 rounded-full border transition-colors min-h-[44px] ${btnClass}`}
            data-testid="quick-actions-trigger"
            aria-haspopup="dialog"
            aria-expanded={open.value}
          >
            Quick actions ({session.quickActions.length})
          </button>
        </div>
        {open.value && (
          <div class="fixed inset-x-0 top-0 z-50 h-[100dvh]">
            <div
              class="absolute inset-0 bg-black/50"
              data-testid="quick-actions-backdrop"
              onClick={handleClose}
            />
            <div
              ref={sheetRef}
              class="absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-2xl flex flex-col border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 max-h-[70dvh]"
              data-testid="quick-actions-sheet"
            >
              <div class="flex justify-center pt-2 pb-1 shrink-0">
                <div class="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
              </div>
              <div class="px-4 py-2 border-b border-slate-200 dark:border-slate-700 shrink-0">
                <h3 class="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Quick actions
                </h3>
              </div>
              <div class="flex-1 overflow-y-auto">
                {session.quickActions.map((action) => (
                  <button
                    key={action.type}
                    onClick={() => handleActionClick(action)}
                    class="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[44px] border-b border-slate-100 dark:border-slate-700 last:border-0"
                    data-testid={`quick-action-${action.type}`}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  const maxVisible = 5
  const hasOverflow = session.quickActions.length > maxVisible
  const visibleActions = hasOverflow ? session.quickActions.slice(0, maxVisible) : session.quickActions
  const overflowActions = hasOverflow ? session.quickActions.slice(maxVisible) : []

  const actionButton = (action: QuickAction, key: string) => (
    <button
      key={key}
      onClick={() => handleActionClick(action)}
      class={`text-xs font-medium px-3.5 py-2 rounded-full border transition-colors min-h-[44px] ${btnClass}`}
      data-testid={`quick-action-${action.type}`}
    >
      {action.label}
    </button>
  )

  return (
    <div
      class="flex flex-wrap gap-2 px-4 py-1.5 border-t relative"
      style={{ borderColor: isDark ? '#374151' : '#e5e7eb' }}
      data-testid="quick-actions-bar"
    >
      {visibleActions.map((action) => actionButton(action, action.type))}
      {hasOverflow && (
        <button
          onClick={handleMoreClick}
          class={`text-xs font-medium px-3.5 py-2 rounded-full border transition-colors min-h-[44px] ${btnClass}`}
          data-testid="quick-actions-more-btn"
          aria-haspopup="dialog"
          aria-expanded={open.value}
        >
          More actions... ({overflowActions.length})
        </button>
      )}
      {open.value && (
        <div
          ref={dropdownRef}
          class="absolute left-4 bottom-full mb-2 z-50 min-w-[220px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-2 max-h-64 overflow-y-auto"
          data-testid="quick-actions-dropdown"
        >
          {overflowActions.map((action) => (
            <button
              key={action.type}
              onClick={() => handleActionClick(action)}
              class="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[44px]"
              data-testid={`quick-action-overflow-${action.type}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface ShipStageConfig {
  label: string
  advanceTo?: ShipStage
  disabled: boolean
}

function getShipStageConfig(stage: ShipStage, childCount: number): ShipStageConfig | null {
  switch (stage) {
    case 'think':
      return { label: 'Move to plan', advanceTo: 'plan', disabled: false }
    case 'plan':
      return { label: 'Start DAG', advanceTo: 'dag', disabled: false }
    case 'dag':
      return { label: `Watching ${childCount} children`, disabled: true }
    case 'verify':
      return { label: 'Mark done', advanceTo: 'done', disabled: false }
    case 'done':
      return null
    default:
      return null
  }
}
