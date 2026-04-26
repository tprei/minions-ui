import { useTheme } from '../hooks/useTheme'

export interface DragHandleProps {
  onPointerDown?: (e: PointerEvent) => void
  onPointerMove?: (e: PointerEvent) => void
  onPointerUp?: (e: PointerEvent) => void
}

export function DragHandle({ onPointerDown, onPointerMove, onPointerUp }: DragHandleProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'

  return (
    <div
      class="flex justify-center pt-2 pb-1 shrink-0 cursor-grab active:cursor-grabbing touch-none"
      // @ts-expect-error - lowercase event handlers work at runtime but TS only types camelCase
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      data-testid="drag-handle"
      aria-label="Swipe down to dismiss"
    >
      <div class={`w-10 h-1 rounded-full ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`} />
    </div>
  )
}
