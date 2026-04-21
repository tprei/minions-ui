import { useSignal, useComputed } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type {
  LoopOverride,
  OverrideField,
  RuntimeConfigResponse,
  RuntimeOverrides,
} from '../api/types'

interface Props {
  config: RuntimeConfigResponse
  onSubmit: (patch: RuntimeOverrides) => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}

type DraftValue = number | boolean

export function RuntimeConfigForm({ config, onSubmit, onDirtyChange }: Props) {
  const draft = useSignal<Record<string, DraftValue>>(buildInitialDraft(config))
  const saving = useSignal(false)
  const errorMessage = useSignal<string | null>(null)
  const successKey = useSignal(0)

  useEffect(() => {
    draft.value = buildInitialDraft(config)
    errorMessage.value = null
  }, [config.base, config.overrides, config.schema])

  const dirty = useComputed(() => hasDirtyFields(draft.value, config))
  useEffect(() => {
    onDirtyChange?.(dirty.value)
  }, [dirty.value])

  const byCategory = useComputed(() => {
    const map = new Map<string, OverrideField[]>()
    for (const f of config.schema.fields) {
      const arr = map.get(f.category) ?? []
      arr.push(f)
      map.set(f.category, arr)
    }
    return map
  })

  const restartTouched = useComputed(() => {
    return config.schema.fields
      .filter((f) => f.apply === 'restart')
      .filter((f) => fieldIsDirty(f, draft.value, config))
      .map((f) => f.key)
  })

  async function save() {
    saving.value = true
    errorMessage.value = null
    try {
      const patch = buildPatch(draft.value, config)
      await onSubmit(patch)
      successKey.value += 1
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : String(err)
    } finally {
      saving.value = false
    }
  }

  function reset() {
    draft.value = buildInitialDraft(config)
    errorMessage.value = null
  }

  return (
    <div class="flex flex-col gap-4" data-testid="runtime-config-form">
      {(config.requiresRestart ?? []).length > 0 && (
        <div
          class="rounded-md border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 p-3 text-xs"
          data-testid="runtime-config-restart-banner"
          key={successKey.value}
        >
          <div class="font-medium">Restart required to apply:</div>
          <ul class="mt-1 list-disc list-inside">
            {(config.requiresRestart ?? []).map((k) => (
              <li key={k}><code>{k}</code></li>
            ))}
          </ul>
        </div>
      )}

      {['loops', 'concurrency', 'features'].map((cat) => {
        const fields = byCategory.value.get(cat) ?? []
        if (fields.length === 0) return null
        return (
          <section key={cat} data-testid={`runtime-config-section-${cat}`}>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              {cat === 'loops' ? 'Loops' : cat === 'concurrency' ? 'Concurrency & quota' : 'Feature toggles'}
            </h3>
            <div class="flex flex-col gap-3">
              {fields.map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  value={draft.value[field.key]}
                  base={baseValueFor(field, config)}
                  hasOverride={overrideValueFor(field, config) !== undefined}
                  onChange={(val) => {
                    draft.value = { ...draft.value, [field.key]: val }
                  }}
                  onClear={() => {
                    const next = { ...draft.value, [field.key]: baseValueFor(field, config) as DraftValue }
                    draft.value = next
                  }}
                />
              ))}
            </div>
          </section>
        )
      })}

      {restartTouched.value.length > 0 && (
        <div class="text-xs text-amber-700 dark:text-amber-300" data-testid="runtime-config-dirty-restart">
          Pending: {restartTouched.value.join(', ')} will take effect on next container restart.
        </div>
      )}

      {errorMessage.value && (
        <div class="rounded-md border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-200 px-3 py-2 text-xs" data-testid="runtime-config-error">
          {errorMessage.value}
        </div>
      )}

      <div class="flex items-center gap-2 sticky bottom-0 bg-white dark:bg-slate-800 pt-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty.value || saving.value}
          class="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700"
          data-testid="runtime-config-save"
        >
          {saving.value ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={!dirty.value || saving.value}
          class="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="runtime-config-reset"
        >
          Revert
        </button>
      </div>
    </div>
  )
}

function FieldRow({
  field,
  value,
  base,
  hasOverride,
  onChange,
  onClear,
}: {
  field: OverrideField
  value: DraftValue
  base: DraftValue
  hasOverride: boolean
  onChange: (val: DraftValue) => void
  onClear: () => void
}) {
  const isBoolean = field.type === 'boolean'
  const isInterval = field.key.endsWith('.intervalMs')

  return (
    <label class="flex flex-col gap-1" data-testid={`runtime-config-field-${field.key}`}>
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm text-slate-800 dark:text-slate-100">{field.label}</span>
        <div class="flex items-center gap-1">
          {field.apply === 'restart' && (
            <span class="text-[10px] font-medium uppercase tracking-wide rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-1.5 py-0.5">
              restart
            </span>
          )}
          {hasOverride && (
            <button
              type="button"
              onClick={onClear}
              class="text-[10px] text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white underline"
              data-testid={`runtime-config-reset-${field.key}`}
            >
              reset
            </button>
          )}
        </div>
      </div>
      {isBoolean ? (
        <input
          type="checkbox"
          class="h-4 w-4 self-start"
          checked={Boolean(value)}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        />
      ) : (
        <div class="flex items-center gap-2">
          <input
            type="number"
            class="w-32 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-sm font-mono"
            value={Number(value)}
            min={field.min}
            max={field.max}
            step={field.integer ? 1 : undefined}
            onInput={(e) => {
              const raw = (e.target as HTMLInputElement).value
              const n = Number(raw)
              if (Number.isFinite(n)) onChange(field.integer ? Math.trunc(n) : n)
            }}
          />
          {isInterval && typeof value === 'number' && (
            <span class="text-[10px] text-slate-500 dark:text-slate-400">≈ {humanizeInterval(value)}</span>
          )}
          <span class="text-[10px] text-slate-400 dark:text-slate-500">default {String(base)}</span>
        </div>
      )}
      {field.description && (
        <span class="text-[10px] text-slate-500 dark:text-slate-400">{field.description}</span>
      )}
    </label>
  )
}

function buildInitialDraft(config: RuntimeConfigResponse): Record<string, DraftValue> {
  const draft: Record<string, DraftValue> = {}
  for (const field of config.schema.fields) {
    const override = overrideValueFor(field, config)
    draft[field.key] = (override ?? baseValueFor(field, config)) as DraftValue
  }
  return draft
}

function baseValueFor(field: OverrideField, config: RuntimeConfigResponse): DraftValue {
  const parts = field.key.split('.')
  if (parts[0] === 'loops' && parts.length === 3) {
    const meta = config.schema.loops.find((l) => l.id === parts[1])
    const baseLoops = (config.base.loops ?? {}) as Record<string, { enabled?: boolean; intervalMs?: number }>
    const baseLoop = baseLoops[parts[1]]
    if (parts[2] === 'enabled') return baseLoop?.enabled ?? meta?.defaultEnabled ?? true
    if (parts[2] === 'intervalMs') return baseLoop?.intervalMs ?? meta?.defaultIntervalMs ?? 60_000
  }
  const v = getAtPath(config.base, parts)
  if (field.type === 'boolean') return Boolean(v)
  return typeof v === 'number' ? v : 0
}

function overrideValueFor(field: OverrideField, config: RuntimeConfigResponse): DraftValue | undefined {
  const parts = field.key.split('.')
  const v = getAtPath(config.overrides, parts)
  if (v === undefined) return undefined
  if (field.type === 'boolean') return Boolean(v)
  return typeof v === 'number' ? v : undefined
}

function hasDirtyFields(draft: Record<string, DraftValue>, config: RuntimeConfigResponse): boolean {
  for (const field of config.schema.fields) {
    if (fieldIsDirty(field, draft, config)) return true
  }
  return false
}

function fieldIsDirty(
  field: OverrideField,
  draft: Record<string, DraftValue>,
  config: RuntimeConfigResponse,
): boolean {
  const effective = overrideValueFor(field, config) ?? baseValueFor(field, config)
  return draft[field.key] !== effective
}

function buildPatch(
  draft: Record<string, DraftValue>,
  config: RuntimeConfigResponse,
): RuntimeOverrides {
  const patch: RuntimeOverrides = {}
  for (const field of config.schema.fields) {
    if (!fieldIsDirty(field, draft, config)) continue
    const base = baseValueFor(field, config)
    const value = draft[field.key]
    const parts = field.key.split('.')

    if (parts[0] === 'loops' && parts.length === 3) {
      patch.loops = patch.loops ?? {}
      const loopPatch: LoopOverride = patch.loops[parts[1]] ?? {}
      if (parts[2] === 'enabled') loopPatch.enabled = Boolean(value)
      if (parts[2] === 'intervalMs') loopPatch.intervalMs = Number(value)
      patch.loops[parts[1]] = loopPatch
      continue
    }

    if (value === base) continue
    assignAtPath(patch, parts, value)
  }
  return patch
}

function getAtPath(root: unknown, parts: string[]): unknown {
  let cursor = root
  for (const p of parts) {
    if (!cursor || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[p]
  }
  return cursor
}

function assignAtPath(root: unknown, parts: string[], value: DraftValue): void {
  if (!root || typeof root !== 'object') return
  let cursor = root as Record<string, unknown>
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]
    const next = cursor[p]
    if (!next || typeof next !== 'object') {
      const fresh: Record<string, unknown> = {}
      cursor[p] = fresh
      cursor = fresh
    } else {
      cursor = next as Record<string, unknown>
    }
  }
  cursor[parts[parts.length - 1]] = value
}

function humanizeInterval(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(0)}m`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`
  return `${(ms / 86_400_000).toFixed(1)}d`
}
