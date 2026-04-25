import type { QuickAction, ApiSession, ShipStage } from '../api/types'
import { useTheme } from '../hooks/useTheme'

interface QuickActionsBarProps {
  session: ApiSession
  onAction: (action: QuickAction) => Promise<void>
  onShipAdvance?: (to: ShipStage) => Promise<void>
}

export function QuickActionsBar({ session, onAction, onShipAdvance }: QuickActionsBarProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'

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
        class="flex flex-wrap gap-2 px-4 py-2 border-t"
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
          class={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${btnClass}`}
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

  return (
    <div
      class="flex flex-wrap gap-2 px-4 py-2 border-t"
      style={{ borderColor: isDark ? '#374151' : '#e5e7eb' }}
      data-testid="quick-actions-bar"
    >
      {session.quickActions.map((action) => (
        <button
          key={action.type}
          onClick={() => void onAction(action)}
          class={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${btnClass}`}
        >
          {action.label}
        </button>
      ))}
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
