import { signal, useSignal, useComputed } from '@preact/signals'
import { useRef, useCallback, useEffect, useState } from 'preact/hooks'
import type { ConnectionStore } from '../state/types'
import type { CreateSessionMode } from '../api/types'
import { hasFeature } from '../api/features'
import { formatRoute } from '../routing/route'
import { recordVariantGroup } from '../groups/store'

const VALID_IMAGE_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export interface ImageAttachment {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  dataBase64: string
  objectUrl: string
}

function readFileAsBase64(file: File): Promise<{ mediaType: string; dataBase64: string; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const comma = result.indexOf(',')
      if (comma === -1) { reject(new Error('Invalid data URL')); return }
      const dataBase64 = result.slice(comma + 1)
      const objectUrl = URL.createObjectURL(file)
      resolve({ mediaType: file.type, dataBase64, objectUrl })
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(file)
  })
}

const COLLAPSE_KEY = 'minions-ui:newtaskbar-collapsed'

export const NEW_TASK_FOCUS_EVENT = 'minions-ui:focus-new-task'

export function requestNewTaskFocus(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(NEW_TASK_FOCUS_EVENT))
}

function readCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(COLLAPSE_KEY) === 'true'
}

function writeCollapsed(v: boolean): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(COLLAPSE_KEY, String(v))
}

export interface ModeOption {
  value: CreateSessionMode
  label: string
  hint: string
}

export const NEW_TASK_MODES: ModeOption[] = [
  { value: 'task', label: 'Task', hint: 'Small implementation task; execute now' },
  { value: 'plan', label: 'Plan', hint: 'Plan first; execute with slash commands' },
  { value: 'think', label: 'Think', hint: 'Research and brainstorm without code changes' },
  { value: 'ship', label: 'Ship', hint: 'Full feature cycle: plan, DAG, verify, PR' },
]

export const VARIANT_COUNTS: ReadonlyArray<number> = [1, 2, 3, 4]

export interface NewTaskExample {
  label: string
  prompt: string
  mode: CreateSessionMode
}

export const NEW_TASK_EXAMPLES: ReadonlyArray<NewTaskExample> = [
  { label: 'Fix flaky test', mode: 'task', prompt: 'Fix the flaky test in <path/to/file> — describe symptoms and any leads.' },
  { label: 'Add /health endpoint', mode: 'task', prompt: 'Add a /health endpoint that returns 200 with build info (commit, version, uptime).' },
  { label: 'Refactor X to Y', mode: 'plan', prompt: 'Plan a refactor: replace <X> with <Y>. Survey call sites first, then propose a migration order.' },
  { label: 'Brainstorm an approach', mode: 'think', prompt: 'Investigate how we could <goal>. Compare 2–3 options with tradeoffs; do not change code yet.' },
]

export const newTaskPrefill = signal<{ prompt: string; mode: CreateSessionMode } | null>(null)

export function prefillNewTask(payload: { prompt: string; mode: CreateSessionMode }): void {
  newTaskPrefill.value = payload
}

export interface NewTaskBarProps {
  store: ConnectionStore
  navigate?: (hash: string) => void
  generateGroupId?: () => string
}

function defaultNavigate(hash: string): void {
  if (typeof window !== 'undefined') {
    window.location.hash = hash
  }
}

function defaultGenerateGroupId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `g-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

export function NewTaskBar({
  store,
  navigate = defaultNavigate,
  generateGroupId = defaultGenerateGroupId,
}: NewTaskBarProps) {
  const mode = useSignal<CreateSessionMode>('task')
  const prompt = useSignal('')
  const repo = useSignal('')
  const variantCount = useSignal(1)
  const sending = useSignal(false)
  const error = useSignal<string | null>(null)
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback(async (files: File[]) => {
    const valid = files.filter((f) => VALID_IMAGE_TYPES.has(f.type))
    if (valid.length === 0) return
    const results = await Promise.all(valid.map(readFileAsBase64))
    setAttachments((prev) => [
      ...prev,
      ...results.map((r) => ({
        mediaType: r.mediaType as ImageAttachment['mediaType'],
        dataBase64: r.dataBase64,
        objectUrl: r.objectUrl,
      })),
    ])
  }, [])

  const handleFileChange = useCallback(
    (e: Event) => {
      const input = e.target as HTMLInputElement
      if (!input.files) return
      void addFiles(Array.from(input.files))
      input.value = ''
    },
    [addFiles],
  )

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageItems: File[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (!item) continue
        if (item.kind === 'file' && VALID_IMAGE_TYPES.has(item.type)) {
          const file = item.getAsFile()
          if (file) imageItems.push(file)
        }
      }
      if (imageItems.length > 0) {
        e.preventDefault()
        void addFiles(imageItems)
      }
    },
    [addFiles],
  )

  const removeAttachment = useCallback((idx: number) => {
    setAttachments((prev) => {
      const next = [...prev]
      const removed = next.splice(idx, 1)
      for (const r of removed) URL.revokeObjectURL(r.objectUrl)
      return next
    })
  }, [])

  useEffect(() => {
    return () => {
      setAttachments((prev) => {
        for (const a of prev) URL.revokeObjectURL(a.objectUrl)
        return []
      })
    }
  }, [])

  const version = store.version.value
  const repos = version?.repos ?? []
  if (repos.length > 0 && !repo.value) {
    repo.value = repos[0].alias
  }

  const canCreate = hasFeature(store, 'sessions-create')
  const canVariants = hasFeature(store, 'sessions-variants')
  const canShip = hasFeature(store, 'ship-coordinator')
  const wantVariants = useComputed(() => variantCount.value > 1)

  const availableModes = NEW_TASK_MODES.filter((m) => m.value !== 'ship' || canShip)

  // Collapsed state is user-controlled via the − button, persisted in
  // localStorage. Defaults to expanded; tests rely on the expanded render.
  const collapsed = useSignal(readCollapsed())
  const promptRef = useRef<HTMLTextAreaElement>(null)

  function toggleCollapsed() {
    const next = !collapsed.value
    collapsed.value = next
    writeCollapsed(next)
  }

  useEffect(() => {
    const handler = () => {
      if (collapsed.value) {
        collapsed.value = false
        writeCollapsed(false)
      }
      setTimeout(() => promptRef.current?.focus(), 0)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener(NEW_TASK_FOCUS_EVENT, handler)
      return () => window.removeEventListener(NEW_TASK_FOCUS_EVENT, handler)
    }
  }, [collapsed])

  const pendingPrefill = newTaskPrefill.value
  useEffect(() => {
    if (!pendingPrefill) return
    prompt.value = pendingPrefill.prompt
    mode.value = pendingPrefill.mode
    if (collapsed.value) {
      collapsed.value = false
      writeCollapsed(false)
    }
    newTaskPrefill.value = null
    queueMicrotask(() => {
      const ta = promptRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    })
  }, [pendingPrefill])

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
      const imagesPayload = attachments.length > 0
        ? attachments.map((a) => ({ mediaType: a.mediaType, dataBase64: a.dataBase64 }))
        : undefined
      if (wantVariants.value) {
        const out = await store.client.createSessionVariants({
          prompt: p,
          mode: mode.value,
          repo: selectedRepo,
          count: variantCount.value,
          images: imagesPayload,
        })
        const slugs: string[] = []
        const errors: string[] = []
        for (const result of out.sessions) {
          if ('slug' in result) slugs.push(result.slug)
          else errors.push(result.error)
        }
        if (slugs.length === 0) {
          error.value = errors[0] ?? 'Failed to create variants'
          return
        }
        const groupId = generateGroupId()
        recordVariantGroup(store.connectionId, {
          groupId,
          prompt: p,
          mode: mode.value,
          repo: selectedRepo,
          variantSessionIds: slugs,
          createdAt: new Date().toISOString(),
        })
        prompt.value = ''
        for (const a of attachments) URL.revokeObjectURL(a.objectUrl)
        setAttachments([])
        if (errors.length > 0) {
          error.value = `${errors.length} variant${errors.length > 1 ? 's' : ''} failed to launch`
        }
        navigate(formatRoute({ name: 'group', groupId }))
      } else {
        const created = await store.client.createSession({
          prompt: p,
          mode: mode.value,
          repo: selectedRepo,
          images: imagesPayload,
        })
        store.applySessionCreated(created)
        prompt.value = ''
        for (const a of attachments) URL.revokeObjectURL(a.objectUrl)
        setAttachments([])
        navigate(formatRoute({ name: 'session', sessionSlug: created.slug }))
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

  if (collapsed.value) {
    return (
      <div
        class="flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
        data-testid="new-task-bar"
        data-collapsed="true"
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          class="flex-1 flex items-center gap-2 rounded-md border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
          data-testid="new-task-expand"
        >
          <span aria-hidden="true">+</span>
          <span>New task</span>
          <span class="ml-auto text-[10px] text-indigo-400 dark:text-indigo-500">expand</span>
        </button>
      </div>
    )
  }

  return (
    <div
      class="flex flex-col gap-3 px-3 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
      data-testid="new-task-bar"
    >
      <div class="flex flex-wrap items-center gap-2.5">
        <div class="flex gap-1.5" role="radiogroup" aria-label="Task mode" data-testid="mode-picker">
          {availableModes.map((m) => {
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
                class={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${btnClass}`}
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

        <select
          value={variantCount.value}
          onChange={(e) => {
            variantCount.value = Number((e.currentTarget as HTMLSelectElement).value)
          }}
          disabled={sending.value}
          title={canVariants ? 'How many parallel variants to spawn' : 'Parallel variants need library ≥ 1.111'}
          aria-label="Variant count"
          data-testid="variant-count"
          class="ml-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 disabled:opacity-50"
        >
          {VARIANT_COUNTS.map((n) => {
            const gated = n > 1 && !canVariants
            return (
              <option key={n} value={n} disabled={gated} data-testid={`variant-${n}`}>
                {n === 1 ? '1 session' : `×${n} variants`}
              </option>
            )
          })}
        </select>
      </div>

      {attachments.length > 0 && (
        <div class="flex flex-wrap gap-2" data-testid="new-task-attachments">
          {attachments.map((a, idx) => (
            <div
              key={a.objectUrl}
              class="relative w-16 h-16 rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 flex-shrink-0"
            >
              <img
                src={a.objectUrl}
                alt={`attachment ${idx + 1}`}
                class="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeAttachment(idx)}
                class="absolute top-0 right-0 w-5 h-5 flex items-center justify-center bg-black/60 text-white text-[10px] rounded-bl"
                aria-label={`Remove attachment ${idx + 1}`}
                data-testid={`remove-attachment-${idx}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div class="flex items-end gap-2.5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          onChange={handleFileChange}
          data-testid="new-task-file-input"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending.value}
          aria-label="Attach image"
          title="Attach image"
          class="shrink-0 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors border shadow-sm disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600"
          data-testid="new-task-attach-btn"
        >
          <PaperclipIcon />
        </button>
        <textarea
          ref={promptRef}
          value={prompt.value}
          onInput={(e) => { prompt.value = (e.currentTarget as HTMLTextAreaElement).value }}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
          disabled={sending.value}
          rows={2}
          placeholder={`New ${mode.value}: describe what you want…`}
          class="flex-1 resize-y rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 disabled:opacity-50"
          data-testid="new-task-prompt"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          class="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          data-testid="new-task-send"
        >
          {launchLabel}
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 px-2.5 py-2.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-700"
          title="Collapse the task bar"
          aria-label="Collapse task bar"
          data-testid="new-task-collapse"
        >
          −
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

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a1.5 1.5 0 0 0 2.122 2.122l6.5-6.5a.75.75 0 0 1 1.06 1.06l-6.5 6.5a3 3 0 0 1-4.242-4.243l7-7a4.5 4.5 0 0 1 6.364 6.364l-7 7a6 6 0 0 1-8.485-8.486l5.5-5.5a.75.75 0 0 1 1.06 1.061l-5.5 5.5a4.5 4.5 0 0 0 6.365 6.364l7-7a3 3 0 0 0 0-4.243Z"
        clipRule="evenodd"
      />
    </svg>
  )
}
