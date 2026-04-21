import { useSignal } from '@preact/signals'
import { useEffect, useCallback } from 'preact/hooks'
import type { ConnectionStore } from '../state/types'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useTheme } from '../hooks/useTheme'
import { ResourcePanel } from '../components/ResourcePanel'
import { RuntimeConfigForm } from './RuntimeConfigForm'
import { hasFeature } from '../api/features'

interface Props {
  store: ConnectionStore
  initialTab?: RuntimeTab
  onClose: () => void
}

export type RuntimeTab = 'resources' | 'config'

export function RuntimeConfigDrawer({ store, initialTab = 'resources', onClose }: Props) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const tab = useSignal<RuntimeTab>(initialTab)

  const hasConfig = hasFeature(store, 'runtime-config')
  const hasMetrics = hasFeature(store, 'resource-metrics')

  useEffect(() => {
    if (hasConfig && !store.runtimeConfig.value) {
      void store.refreshRuntimeConfig()
    }
  }, [hasConfig])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSubmit = useCallback(
    async (patch: Parameters<ConnectionStore['updateRuntimeConfig']>[0]) => {
      await store.updateRuntimeConfig(patch)
    },
    [store],
  )

  const panelBg = isDark ? 'bg-gray-800' : 'bg-white'
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200'

  const inner = (
    <div class={`flex flex-col h-full ${panelBg}`} data-testid="runtime-config-drawer">
      <header class={`flex items-center gap-2 px-4 py-3 border-b shrink-0 ${borderColor}`}>
        <span class={`flex-1 font-semibold text-sm ${isDark ? 'text-white' : 'text-slate-900'}`}>
          Runtime
        </span>
        <button
          onClick={onClose}
          class={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-slate-500'}`}
          aria-label="Close drawer"
          data-testid="runtime-config-close"
        >
          <span class="text-lg leading-none">&times;</span>
        </button>
      </header>

      <div class={`flex border-b shrink-0 ${borderColor}`}>
        <TabButton
          label="Resources"
          active={tab.value === 'resources'}
          disabled={!hasMetrics}
          onClick={() => { tab.value = 'resources' }}
          testId="runtime-tab-resources"
        />
        <TabButton
          label="Config"
          active={tab.value === 'config'}
          disabled={!hasConfig}
          onClick={() => { tab.value = 'config' }}
          testId="runtime-tab-config"
        />
      </div>

      <div class="flex-1 overflow-y-auto">
        {tab.value === 'resources' && (
          hasMetrics ? (
            <ResourcePanel snapshot={store.resourceSnapshot.value} />
          ) : (
            <UnavailableNotice label="Resource metrics" />
          )
        )}
        {tab.value === 'config' && (
          hasConfig ? (
            store.runtimeConfig.value ? (
              <div class="p-4">
                <RuntimeConfigForm
                  config={store.runtimeConfig.value}
                  onSubmit={handleSubmit}
                />
              </div>
            ) : (
              <div class="p-4 text-sm text-slate-500 dark:text-slate-400">Loading…</div>
            )
          ) : (
            <UnavailableNotice label="Runtime config" />
          )
        )}
      </div>
    </div>
  )

  if (isDesktop.value) {
    return (
      <div class="fixed inset-x-0 top-0 z-50 flex h-[100dvh]">
        <div
          class="absolute inset-0 bg-black/50"
          data-testid="runtime-config-backdrop"
          onClick={onClose}
        />
        <div class={`relative ml-auto w-full max-w-md h-full shadow-2xl flex flex-col border-l ${borderColor} ${panelBg}`}>
          {inner}
        </div>
      </div>
    )
  }

  return (
    <div class="fixed inset-x-0 top-0 z-50 h-[100dvh]">
      <div
        class="absolute inset-0 bg-black/50"
        data-testid="runtime-config-backdrop"
        onClick={onClose}
      />
      <div class={`absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-2xl flex flex-col border-t max-h-[85dvh] ${borderColor} ${panelBg}`}>
        <div class="flex justify-center pt-2 pb-1 shrink-0">
          <div class={`w-10 h-1 rounded-full ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`} />
        </div>
        {inner}
      </div>
    </div>
  )
}

function TabButton({
  label,
  active,
  disabled,
  onClick,
  testId,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      class={`flex-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
        active
          ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
          : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      data-testid={testId}
    >
      {label}
    </button>
  )
}

function UnavailableNotice({ label }: { label: string }) {
  return (
    <div class="p-4 text-xs text-slate-500 dark:text-slate-400">
      {label} is not available on this minion (backend library is out of date).
    </div>
  )
}
