import { signal } from '@preact/signals'
import { createApiClient, ApiError } from '../api/client'
import { addConnection, setActive } from './store'

interface Props {
  onClose: () => void
}

export function ConnectionSettings({ onClose }: Props) {
  const label = signal('')
  const baseUrl = signal('')
  const token = signal('')
  const err = signal<string | null>(null)
  const loading = signal(false)
  const features = signal<string[]>([])

  async function submit(e: Event) {
    e.preventDefault()
    err.value = null
    features.value = []
    loading.value = true
    try {
      const client = createApiClient({ baseUrl: baseUrl.value.trim(), token: token.value.trim() })
      const info = await client.getVersion()
      features.value = info.features
      const conn = addConnection({
        label: label.value.trim() || baseUrl.value.trim(),
        baseUrl: baseUrl.value.trim(),
        token: token.value.trim(),
      })
      setActive(conn.id)
      onClose()
    } catch (e) {
      if (e instanceof ApiError) {
        err.value = e.status === 401 ? 'Unauthorized — check your token.' : `Error ${e.status}: ${e.message}`
      } else {
        err.value = e instanceof Error ? e.message : 'Network error'
      }
    } finally {
      loading.value = false
    }
  }

  return (
    <div class="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-8 flex flex-col gap-4">
      <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100">Add connection</h2>
      <form onSubmit={submit} class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-slate-600 dark:text-slate-400">Label</span>
          <input
            type="text"
            placeholder="My minion"
            value={label.value}
            onInput={(e) => { label.value = (e.target as HTMLInputElement).value }}
            class="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-slate-600 dark:text-slate-400">Base URL</span>
          <input
            type="url"
            placeholder="https://your-minion.fly.dev"
            value={baseUrl.value}
            onInput={(e) => { baseUrl.value = (e.target as HTMLInputElement).value }}
            required
            class="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-slate-600 dark:text-slate-400">Token</span>
          <input
            type="password"
            placeholder="bearer token"
            value={token.value}
            onInput={(e) => { token.value = (e.target as HTMLInputElement).value }}
            class="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        {err.value && (
          <p class="text-xs text-red-600 dark:text-red-400">{err.value}</p>
        )}
        {features.value.length > 0 && (
          <div class="flex flex-wrap gap-1">
            {features.value.map((f) => (
              <span key={f} class="rounded-full bg-indigo-100 dark:bg-indigo-900 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                {f}
              </span>
            ))}
          </div>
        )}
        <div class="flex gap-2 mt-1">
          <button
            type="button"
            onClick={onClose}
            class="flex-1 rounded-lg border border-slate-200 dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading.value}
            class="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading.value ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  )
}
