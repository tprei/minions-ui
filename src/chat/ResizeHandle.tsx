// Vertical 6-px draggable grip shown between panels on desktop. Double-click
// resets the caller-managed width to its default.
export function ResizeHandle({
  onMouseDown,
  onDoubleClick,
}: {
  onMouseDown: (e: MouseEvent | TouchEvent) => void
  onDoubleClick?: () => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize · double-click to reset"
      onMouseDown={onMouseDown}
      onTouchStart={onMouseDown}
      onDblClick={onDoubleClick}
      class="group relative w-1.5 shrink-0 cursor-col-resize bg-slate-200 dark:bg-slate-700 hover:bg-indigo-400 dark:hover:bg-indigo-500 transition-colors"
      data-testid="resize-handle"
    >
      <span
        class="absolute inset-y-0 left-1/2 w-0 group-hover:w-1 -translate-x-1/2 bg-indigo-500 dark:bg-indigo-400 transition-all"
        aria-hidden="true"
      />
    </div>
  )
}
