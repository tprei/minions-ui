import { signal } from '@preact/signals'
import { connections, activeId, getActiveStore } from './connections/store'
import { ConnectionSettings } from './connections/ConnectionSettings'
import type { ApiSession } from './api/types'

const showSettings = signal(false)

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'live'
      ? 'bg-green-500'
      : status === 'retrying'
        ? 'bg-yellow-500'
        : status === 'connecting'
          ? 'bg-blue-500'
          : 'bg-slate-400'
  return (
    <span class="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
      <span class={`inline-block h-2 w-2 rounded-full ${color}`} />
      {status}
    </span>
  )
}

function SessionsList({ sessions }: { sessions: ApiSession[] }) {
  return (
    <ul class="divide-y divide-slate-100 dark:divide-slate-700">
      {sessions.map((s) => (
        <li key={s.id} class="px-4 py-3 text-sm text-slate-800 dark:text-slate-200">
          <span class="font-mono">{s.slug}</span>
          <span class="mx-2 text-slate-400">—</span>
          <span class="text-slate-500 dark:text-slate-400">{s.status}</span>
        </li>
      ))}
    </ul>
  )
}

function ActiveView() {
  const id = activeId.value
  const store = id ? getActiveStore() : null
  const conn = connections.value.find((c) => c.id === id)

  if (!store || !conn) return null

  return (
    <div class="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-900">
      <header class="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <span
          class="h-3 w-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: conn.color }}
        />
        <span class="font-medium text-slate-900 dark:text-slate-100 flex-1">{conn.label}</span>
        <StatusBadge status={store.status.value} />
        <button
          onClick={() => { showSettings.value = true }}
          class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 ml-2"
        >
          Manage connections
        </button>
      </header>
      {store.error.value && (
        <div class="flex items-center gap-3 px-4 py-2 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          <span class="flex-1">{store.error.value}</span>
          <button
            onClick={() => void store.refresh()}
            class="text-xs font-medium underline"
          >
            Retry
          </button>
        </div>
      )}
      <main class="flex-1 overflow-auto">
        <SessionsList sessions={store.sessions.value} />
      </main>
    </div>
  )
}

export default function App() {
  if (connections.value.length === 0 || showSettings.value) {
    return (
      <div class="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        {showSettings.value ? (
          <ConnectionSettings onClose={() => { showSettings.value = false }} />
        ) : (
          <div class="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-8 flex flex-col items-center gap-4 text-center">
            <h1 class="text-xl font-semibold text-slate-900 dark:text-slate-100">Connect a minion</h1>
            <p class="text-sm text-slate-500 dark:text-slate-400">
              Paste a minion's base URL and token to get started
            </p>
            <button
              onClick={() => { showSettings.value = true }}
              class="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Add connection
            </button>
          </div>
        )}
      </div>
    )
  }

  return <ActiveView />
}
