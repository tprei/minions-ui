import { signal } from '@preact/signals'

export const showMemoryDrawer = signal(false)

export function MemoryDrawer() {
  return (
    <>
      {showMemoryDrawer.value && (
        <div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/20 backdrop-blur-sm">
          <div
            class="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-h-[90vh] sm:max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-100">Memory</h2>
              <button
                onClick={() => (showMemoryDrawer.value = false)}
                class="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                aria-label="Close"
              >
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="flex-1 overflow-y-auto p-6">
              <div class="text-center py-8 text-slate-500 dark:text-slate-400">
                <p class="text-lg">Memory management coming soon</p>
                <p class="text-sm mt-2">This feature will allow you to review and manage proposed memories.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
