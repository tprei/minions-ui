import { signal } from '@preact/signals'
import { useEffect, useCallback } from 'preact/hooks'
import type { VNode } from 'preact'

export type ConfirmMode = 'confirm' | 'alert'

export interface ConfirmRequest {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  mode?: ConfirmMode
  destructive?: boolean
}

interface ConfirmState {
  req: ConfirmRequest
  resolve: (value: boolean) => void
}

const pending = signal<ConfirmState | null>(null)

export function confirm(req: ConfirmRequest): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    pending.value = { req, resolve }
  })
}

export function ConfirmRoot(): VNode | null {
  const state = pending.value

  const handleConfirm = useCallback(() => {
    const s = pending.value
    if (s) {
      pending.value = null
      s.resolve(true)
    }
  }, [])

  const handleCancel = useCallback(() => {
    const s = pending.value
    if (s) {
      pending.value = null
      s.resolve(false)
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!pending.value) return
      if (e.key === 'Escape') handleCancel()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handleCancel])

  if (!state) return null

  const { req } = state
  const mode = req.mode ?? 'confirm'
  const confirmLabel = req.confirmLabel ?? 'OK'
  const cancelLabel = req.cancelLabel ?? 'Cancel'

  const confirmBtn = req.destructive
    ? 'bg-red-600 hover:bg-red-700 text-white dark:bg-red-700 dark:hover:bg-red-800'
    : 'bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-700 dark:hover:bg-blue-800'

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div
        class="absolute inset-0 bg-black/50 dark:bg-black/70"
        onClick={mode === 'alert' ? handleConfirm : handleCancel}
      />
      <div
        class="relative bg-white dark:bg-gray-800 rounded-lg p-4 max-w-sm w-full mx-4 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        {req.title && (
          <h3 id="confirm-title" class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {req.title}
          </h3>
        )}
        <p class="text-sm text-gray-600 dark:text-gray-300 mb-4">{req.message}</p>
        <div class="flex justify-end gap-2">
          {mode === 'confirm' && (
            <button
              onClick={handleCancel}
              class="px-4 py-2 text-sm font-medium rounded transition-colors text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {cancelLabel}
            </button>
          )}
          <button
            onClick={handleConfirm}
            class={`px-4 py-2 text-sm font-medium rounded transition-colors ${confirmBtn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
