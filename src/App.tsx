export default function App() {
  return (
    <div class="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
      <div class="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-8 flex flex-col items-center gap-4 text-center">
        <h1 class="text-xl font-semibold text-slate-900 dark:text-slate-100">Connect a minion</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          Paste a minion's base URL and token to get started
        </p>
        <button
          disabled
          class="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white opacity-40 cursor-not-allowed"
        >
          Add connection
        </button>
      </div>
    </div>
  )
}
