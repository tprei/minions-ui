import { useSignal } from '@preact/signals'
import { createApiClient, ApiError } from '../api/client'
import { addConnection, updateConnection, setActive } from './store'
import type { Connection } from './types'
import { CONNECTION_PALETTE } from '../theme/colors'

interface Props {
  onClose: () => void
  existing?: Connection
  embedded?: boolean
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function ConnectionSettings({ onClose, existing, embedded }: Props) {
  const label = useSignal(existing?.label ?? '')
  const baseUrl = useSignal(existing?.baseUrl ?? '')
  const token = useSignal(existing?.token ?? '')
  const color = useSignal(existing?.color ?? CONNECTION_PALETTE[0])
  const customHex = useSignal('')
  const err = useSignal<string | null>(null)
  const loading = useSignal(false)
  const features = useSignal<string[]>([])

  async function submit(e: Event) {
    e.preventDefault()
    err.value = null
    features.value = []

    const trimmedLabel = label.value.trim()
    const trimmedUrl = baseUrl.value.trim()

    if (!trimmedLabel) {
      err.value = 'Label is required.'
      return
    }
    if (!trimmedUrl) {
      err.value = 'Base URL is required.'
      return
    }

    loading.value = true
    try {
      if (existing) {
        updateConnection(existing.id, {
          label: trimmedLabel,
          baseUrl: trimmedUrl,
          token: token.value.trim(),
          color: color.value,
        })
        onClose()
      } else {
        const client = createApiClient({ baseUrl: trimmedUrl, token: token.value.trim() })
        const info = await client.getVersion()
        features.value = info.features
        const conn = addConnection({
          label: trimmedLabel || trimmedUrl,
          baseUrl: trimmedUrl,
          token: token.value.trim(),
          color: color.value,
        })
        setActive(conn.id)
        onClose()
      }
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

  const containerClass = embedded
    ? 'flex flex-col gap-4'
    : 'w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-8 flex flex-col gap-4'

  return (
    <div class={containerClass}>
      <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100">
        {existing ? 'Edit connection' : 'Add connection'}
      </h2>
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
        <div class="flex flex-col gap-2">
          <span class="text-xs font-medium text-slate-600 dark:text-slate-400">Color</span>
          <div class="flex flex-wrap gap-2" data-testid="color-swatches">
            {CONNECTION_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                data-testid={`swatch-${c}`}
                onClick={() => { color.value = c; customHex.value = '' }}
                class="h-6 w-6 rounded-full border-2 transition-transform focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500"
                style={{
                  backgroundColor: c,
                  borderColor: color.value === c ? 'white' : 'transparent',
                  boxShadow: color.value === c ? `0 0 0 2px ${c}` : undefined,
                  transform: color.value === c ? 'scale(1.15)' : undefined,
                }}
                aria-label={`Color ${c}`}
                aria-pressed={color.value === c}
              />
            ))}
          </div>
          <div class="flex items-center gap-2">
            <span
              class="h-5 w-5 rounded-full shrink-0 border border-slate-200 dark:border-slate-600"
              style={{ backgroundColor: color.value }}
            />
            <input
              type="text"
              data-testid="custom-hex-input"
              placeholder="#a1b2c3"
              maxLength={7}
              value={customHex.value}
              onInput={(e) => {
                const val = (e.target as HTMLInputElement).value
                customHex.value = val
                if (HEX_RE.test(val)) color.value = val
              }}
              class="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-28"
            />
          </div>
        </div>
        {err.value && (
          <p class="text-xs text-red-600 dark:text-red-400" data-testid="settings-error">{err.value}</p>
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
            {loading.value ? 'Connecting…' : existing ? 'Save' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  )
}
