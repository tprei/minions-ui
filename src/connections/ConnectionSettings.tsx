import { useMemo, useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { createApiClient, ApiError } from '../api/client'
import { addConnection, updateConnection, setActive } from './store'
import type { Connection } from './types'
import { CONNECTION_PALETTE } from '../theme/colors'
import { EnableNotifications } from '../pwa/EnableNotifications'
import { isPushFlagEnabled } from '../pwa/push'
import { QrScanner } from './QrScanner'

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
  const serverProvider = useSignal<'claude' | 'codex' | null>(null)
  const showQrScanner = useSignal(false)

  const showPushPanel = Boolean(existing) && isPushFlagEnabled()
  const editClient = useMemo(
    () =>
      showPushPanel && existing
        ? createApiClient({ baseUrl: existing.baseUrl, token: existing.token })
        : null,
    [showPushPanel, existing?.id, existing?.baseUrl, existing?.token],
  )
  const editFeatures = useSignal<string[] | null>(null)
  const editFeaturesError = useSignal<string | null>(null)

  useEffect(() => {
    if (!editClient) return
    let cancelled = false
    editFeatures.value = null
    editFeaturesError.value = null
    void editClient
      .getVersion()
      .then((info) => {
        if (cancelled) return
        editFeatures.value = info.features
      })
      .catch((e: unknown) => {
        if (cancelled) return
        editFeatures.value = []
        editFeaturesError.value = e instanceof Error ? e.message : 'Could not fetch features'
      })
    return () => {
      cancelled = true
    }
  }, [editClient])

  useEffect(() => {
    if (!existing) return
    let cancelled = false
    serverProvider.value = null
    const client = createApiClient({ baseUrl: existing.baseUrl, token: existing.token })
    void client
      .getVersion()
      .then((info) => {
        if (cancelled) return
        serverProvider.value = info.provider ?? null
      })
      .catch(() => {
        // best-effort; badge omitted on network error
      })
    return () => {
      cancelled = true
    }
  }, [existing?.id, existing?.baseUrl, existing?.token])

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

  const handleQrScan = (data: Partial<Pick<Connection, 'baseUrl' | 'token' | 'label'>>) => {
    if (data.baseUrl) baseUrl.value = data.baseUrl
    if (data.token) token.value = data.token
    if (data.label) label.value = data.label
    err.value = null
  }

  const handleQrError = (error: string) => {
    err.value = error
  }

  if (showQrScanner.value && !existing) {
    return (
      <div class={containerClass}>
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Scan QR Code
        </h2>
        <QrScanner
          onScan={handleQrScan}
          onError={handleQrError}
          onClose={() => { showQrScanner.value = false }}
        />
        {err.value && (
          <p class="text-xs text-red-600 dark:text-red-400" data-testid="qr-error">{err.value}</p>
        )}
        <button
          type="button"
          onClick={() => { showQrScanner.value = false }}
          class="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[44px]"
        >
          Enter manually
        </button>
      </div>
    )
  }

  return (
    <div class={containerClass}>
      <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100">
        {existing ? 'Edit connection' : 'Add connection'}
      </h2>
      <form onSubmit={submit} class="flex flex-col gap-3">
        {!existing && (
          <button
            type="button"
            onClick={() => { showQrScanner.value = true }}
            class="w-full rounded-lg border border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 px-4 py-3 text-sm font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors min-h-[44px] flex items-center justify-center gap-2"
            data-testid="scan-qr-btn"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
            Scan QR Code
          </button>
        )}
        {!existing && (
          <div class="flex items-center gap-2">
            <div class="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
            <span class="text-xs text-slate-500 dark:text-slate-400">or enter manually</span>
            <div class="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
          </div>
        )}
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
                class="min-h-[44px] min-w-[44px] rounded-full border-2 transition-transform focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500 flex items-center justify-center"
                aria-label={`Color ${c}`}
                aria-pressed={color.value === c}
              >
                <span
                  class="h-6 w-6 rounded-full block"
                  style={{
                    backgroundColor: c,
                    border: color.value === c ? `2px solid white` : undefined,
                    boxShadow: color.value === c ? `0 0 0 2px ${c}` : undefined,
                    transform: color.value === c ? 'scale(1.15)' : undefined,
                  }}
                />
              </button>
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
        {serverProvider.value && (
          <div class="flex items-center gap-1.5" data-testid="backend-badge">
            <span class="text-xs text-slate-500 dark:text-slate-400">Backend:</span>
            <span class="rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
              {serverProvider.value === 'claude' ? 'Claude' : 'Codex'}
            </span>
          </div>
        )}
        {showPushPanel && editClient && (
          <div class="flex flex-col gap-2 border-t border-slate-200 dark:border-slate-700 pt-3" data-testid="push-section">
            <span class="text-xs font-medium text-slate-600 dark:text-slate-400">Notifications</span>
            {editFeatures.value === null ? (
              <p class="text-xs text-slate-500 dark:text-slate-400">Checking server features…</p>
            ) : editFeaturesError.value ? (
              <p class="text-xs text-red-600 dark:text-red-400" data-testid="push-features-error">
                {editFeaturesError.value}
              </p>
            ) : (
              <EnableNotifications
                client={editClient}
                hasFeature={editFeatures.value.includes('web-push')}
              />
            )}
          </div>
        )}
        <div class="flex gap-2 mt-1">
          <button
            type="button"
            onClick={onClose}
            class="flex-1 rounded-lg border border-slate-200 dark:border-slate-600 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[44px]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading.value}
            class="flex-1 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
          >
            {loading.value ? 'Connecting…' : existing ? 'Save' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  )
}
