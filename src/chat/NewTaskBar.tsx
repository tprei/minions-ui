import { useSignal, useComputed } from '@preact/signals'
import type { ConnectionStore } from '../state/types'
import type { CreateSessionMode } from '../api/types'
import { hasFeature } from '../api/features'
import { formatRoute } from '../routing/route'
import { recordVariantGroup } from '../groups/store'

export interface ModeOption {
  value: CreateSessionMode
  label: string
  hint: string
}

export const NEW_TASK_MODES: ModeOption[] = [
  { value: 'task', label: 'Task', hint: 'Execute end-to-end' },
  { value: 'plan', label: 'Plan', hint: 'Produce a plan; no execution' },
  { value: 'think', label: 'Think', hint: 'Deliberate; no side effects' },
  { value: 'ship', label: 'Ship', hint: 'Finish with a PR' },
]

export const VARIANT_COUNTS: ReadonlyArray<number> = [1, 2, 3, 4]

export interface NewTaskBarProps {
  store: ConnectionStore
  navigate?: (hash: string) => void
}

function defaultNavigate(hash: string): void {
  if (typeof window !== 'undefined') {
    window.location.hash = hash
  }
}

export function NewTaskBar({ store, navigate = defaultNavigate }: NewTaskBarProps) {
  const mode = useSignal<CreateSessionMode>('task')
  const prompt = useSignal('')
  const repo = useSignal('')
  const variantCount = useSignal(1)
  const sending = useSignal(false)
  const error = useSignal<string | null>(null)

  const version = store.version.value
  const repos = version?.repos ?? []
  if (repos.length > 0 && !repo.value) {
    repo.value = repos[0].alias
  }

  const canCreate = hasFeature(store, 'sessions-create')
  const canVariants = hasFeature(store, 'sessions-variants')
  const wantVariants = useComputed(() => variantCount.value > 1)

  if (!canCreate) {
    return (
      <div
        class="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-500 dark:text-slate-400"
        data-testid="new-task-bar"
        data-gated="true"
      >
        <span class="font-medium text-slate-600 dark:text-slate-300">Structured task creation disabled</span>
        <span>needs library ≥ 1.111</span>
      </div>
    )
  }

  const submit = async () => {
    const p = prompt.value.trim()
    if (!p || sending.value) return
    if (wantVariants.value && !canVariants) {
      error.value = 'Parallel variants need library ≥ 1.111'
      return
    }
    sending.value = true
    error.value = null
    try {
      const selectedRepo = repo.value || undefined
      if (wantVariants.value) {
        const out = await store.client.createSessionVariants({
          prompt: p,
          mode: mode.value,
          repo: selectedRepo,
          count: variantCount.value,
        })
        recordVariantGroup(store.connectionId, {
          groupId: out.groupId,
          prompt: p,
          mode: mode.value,
          repo: selectedRepo,
          variantSessionIds: out.sessions.map((s) => s.id),
          createdAt: new Date().toISOString(),
        })
        prompt.value = ''
        navigate(formatRoute({ name: 'group', groupId: out.groupId }))
      } else {
        await store.client.createSession({
          prompt: p,
          mode: mode.value,
          repo: selectedRepo,
        })
        prompt.value = ''
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Send failed'
    } finally {
      sending.value = false
    }
  }

  const canSubmit = !sending.value && prompt.value.trim().length > 0 && !(wantVariants.value && !canVariants)
  const launchLabel = sending.value
    ? '…'
    : wantVariants.value
      ? `Launch ×${variantCount.value}`
      : 'Launch'

  return (
    <div
      class="flex flex-col gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
      data-testid="new-task-bar"
    >
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex gap-1" role="radiogroup" aria-label="Task mode" data-testid="mode-picker">
          {NEW_TASK_MODES.map((m) => {
            const active = mode.value === m.value
            const btnClass = active
              ? 'bg-indigo-600 text-white border-indigo-700'
              : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={active}
                title={m.hint}
                disabled={sending.value}
                onClick={() => { mode.value = m.value }}
                data-testid={`mode-${m.value}`}
                class={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${btnClass}`}
              >
                {m.label}
              </button>
            )
          })}
        </div>

        {repos.length > 0 && (
          <select
            value={repo.value}
            onChange={(e) => { repo.value = (e.currentTarget as HTMLSelectElement).value }}
            disabled={sending.value}
            title="Repo to run the task against"
            class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 disabled:opacity-50"
            data-testid="new-task-repo-select"
          >
            {repos.map((r) => (
              <option key={r.alias} value={r.alias}>{r.alias}</option>
            ))}
            <option value="">(no repo)</option>
          </select>
        )}

        <div
          class="flex items-center gap-1 ml-auto"
          role="group"
          aria-label="Variant count"
          data-testid="variant-count"
        >
          <span class="text-xs text-slate-500 dark:text-slate-400">×</span>
          {VARIANT_COUNTS.map((n) => {
            const active = variantCount.value === n
            const gated = n > 1 && !canVariants
            const btnClass = active
              ? 'bg-indigo-600 text-white border-indigo-700'
              : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
            return (
              <button
                key={n}
                type="button"
                onClick={() => { variantCount.value = n }}
                disabled={sending.value || gated}
                title={gated ? 'Parallel variants need library ≥ 1.111' : n === 1 ? 'Single session' : `${n} parallel variants`}
                data-testid={`variant-${n}`}
                aria-pressed={active}
                class={`h-7 min-w-7 rounded-full border px-2 text-xs font-medium transition-colors disabled:opacity-40 ${btnClass}`}
              >
                {n}
              </button>
            )
          })}
        </div>
      </div>

      <div class="flex items-end gap-2">
        <textarea
          value={prompt.value}
          onInput={(e) => { prompt.value = (e.currentTarget as HTMLTextAreaElement).value }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
          disabled={sending.value}
          rows={2}
          placeholder={`New ${mode.value}: describe what you want…`}
          class="flex-1 resize-y rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 disabled:opacity-50"
          data-testid="new-task-prompt"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          data-testid="new-task-send"
        >
          {launchLabel}
        </button>
      </div>

      {error.value && (
        <div class="text-xs text-red-600 dark:text-red-400" data-testid="new-task-error">
          {error.value}
        </div>
      )}
    </div>
  )
}
