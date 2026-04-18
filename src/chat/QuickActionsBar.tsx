import type { QuickAction } from '../api/types'
import { useTheme } from '../hooks/useTheme'

interface QuickActionsBarProps {
  actions: QuickAction[]
  onAction: (action: QuickAction) => Promise<void>
}

export function QuickActionsBar({ actions, onAction }: QuickActionsBarProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'

  if (actions.length === 0) return null

  const btnClass = isDark
    ? 'bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-600'
    : 'bg-gray-100 hover:bg-gray-200 text-gray-800 border-gray-200'

  return (
    <div
      class="flex flex-wrap gap-2 px-4 py-2 border-t"
      style={{ borderColor: isDark ? '#374151' : '#e5e7eb' }}
      data-testid="quick-actions-bar"
    >
      {actions.map((action) => (
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
