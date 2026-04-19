import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ApiClient } from '../api/client'
import type { PrCheck, PrCheckStatus, PrPreview, PrState } from '../api/types'
import { renderMarkdown } from './markdown'

export const PR_PREVIEW_POLL_MS = 30_000

interface PrPreviewCardProps {
  sessionId: string
  prUrl: string
  client: ApiClient
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; pr: PrPreview }

export interface ChecksRollup {
  pass: number
  fail: number
  pending: number
  neutral: number
  total: number
}

export function rollupChecks(checks: PrCheck[]): ChecksRollup {
  const rollup: ChecksRollup = { pass: 0, fail: 0, pending: 0, neutral: 0, total: checks.length }
  for (const c of checks) rollup[bucketForStatus(c.status)] += 1
  return rollup
}

function bucketForStatus(status: PrCheckStatus): 'pass' | 'fail' | 'pending' | 'neutral' {
  switch (status) {
    case 'success':
      return 'pass'
    case 'failure':
    case 'action_required':
    case 'timed_out':
    case 'cancelled':
      return 'fail'
    case 'queued':
    case 'in_progress':
    case 'pending':
      return 'pending'
    case 'neutral':
    case 'skipped':
    case 'stale':
      return 'neutral'
  }
}

function isTerminalState(state: PrState): boolean {
  return state === 'merged' || state === 'closed'
}

function stateBadgeClasses(state: PrState): string {
  if (state === 'merged') return 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
  if (state === 'closed') return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
  return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
}

function stateLabel(state: PrState): string {
  return state.toUpperCase()
}

function ChecksSummary({ rollup }: { rollup: ChecksRollup }) {
  if (rollup.total === 0) {
    return (
      <span class="text-xs text-slate-500 dark:text-slate-400" data-testid="pr-checks-empty">
        no checks
      </span>
    )
  }
  return (
    <span class="flex items-center gap-2 text-xs" data-testid="pr-checks-summary">
      {rollup.pass > 0 && (
        <span class="flex items-center gap-1 text-green-700 dark:text-green-400" data-testid="pr-checks-pass">
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
          {rollup.pass} pass
        </span>
      )}
      {rollup.fail > 0 && (
        <span class="flex items-center gap-1 text-red-700 dark:text-red-400" data-testid="pr-checks-fail">
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
          {rollup.fail} fail
        </span>
      )}
      {rollup.pending > 0 && (
        <span class="flex items-center gap-1 text-amber-700 dark:text-amber-400" data-testid="pr-checks-pending">
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
          {rollup.pending} pending
        </span>
      )}
      {rollup.neutral > 0 && (
        <span class="flex items-center gap-1 text-slate-500 dark:text-slate-400" data-testid="pr-checks-neutral">
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
          {rollup.neutral}
        </span>
      )}
    </span>
  )
}

function AuthorChip({ login }: { login: string }) {
  const avatar = `https://github.com/${encodeURIComponent(login)}.png?size=32`
  return (
    <span class="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300" data-testid="pr-author">
      <img
        src={avatar}
        alt=""
        width={16}
        height={16}
        class="h-4 w-4 rounded-full bg-slate-200 dark:bg-slate-700"
        referrerpolicy="no-referrer"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
        }}
      />
      <span class="font-medium">{login}</span>
    </span>
  )
}

function LoadingCard() {
  return (
    <div
      class="mx-3 mt-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-500 dark:text-slate-400"
      data-testid="pr-preview-loading"
    >
      Loading PR preview…
    </div>
  )
}

function ErrorCard({ message, prUrl, onRetry }: { message: string; prUrl: string; onRetry: () => void }) {
  return (
    <div
      class="mx-3 mt-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 flex items-center gap-2"
      data-testid="pr-preview-error"
    >
      <span class="text-xs text-red-700 dark:text-red-300 flex-1 min-w-0 truncate">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        class="text-xs font-medium underline text-red-700 dark:text-red-300"
        data-testid="pr-preview-retry"
      >
        Retry
      </button>
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="text-xs font-medium underline text-red-700 dark:text-red-300"
      >
        Open on GitHub
      </a>
    </div>
  )
}

export function PrPreviewCard({ sessionId, prUrl, client }: PrPreviewCardProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [expanded, setExpanded] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const aliveRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    aliveRef.current = true
    setState({ kind: 'loading' })

    function clearTimer() {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    async function load() {
      try {
        const pr = await client.getPr(sessionId)
        if (!aliveRef.current) return
        setState({ kind: 'ready', pr })
        clearTimer()
        if (!isTerminalState(pr.state)) {
          timerRef.current = setTimeout(load, PR_PREVIEW_POLL_MS)
        }
      } catch (e) {
        if (!aliveRef.current) return
        const message = e instanceof Error ? e.message : String(e)
        setState({ kind: 'error', message })
        clearTimer()
        timerRef.current = setTimeout(load, PR_PREVIEW_POLL_MS)
      }
    }

    void load()

    return () => {
      aliveRef.current = false
      clearTimer()
    }
  }, [sessionId, client, reloadNonce])

  const bodyHtml = useMemo(() => {
    if (state.kind !== 'ready') return ''
    const body = state.pr.body?.trim()
    return body ? renderMarkdown(body) : ''
  }, [state])

  if (state.kind === 'loading') return <LoadingCard />
  if (state.kind === 'error') {
    return (
      <ErrorCard
        message={state.message}
        prUrl={prUrl}
        onRetry={() => {
          setState({ kind: 'loading' })
          setReloadNonce((n) => n + 1)
        }}
      />
    )
  }

  const pr = state.pr
  const rollup = rollupChecks(pr.checks)

  return (
    <section
      class="mx-3 mt-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden"
      data-testid="pr-preview-card"
    >
      <header class="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700">
        <span
          class={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${stateBadgeClasses(pr.state)}`}
          data-testid="pr-state-badge"
        >
          {stateLabel(pr.state)}
        </span>
        {pr.draft && (
          <span
            class="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
            data-testid="pr-draft-pill"
          >
            Draft
          </span>
        )}
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          class="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100 hover:underline"
          data-testid="pr-title"
        >
          {pr.title}
        </a>
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs font-mono text-slate-500 dark:text-slate-400 hover:underline"
          data-testid="pr-number"
        >
          #{pr.number}
        </a>
      </header>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
        <span class="font-mono truncate" data-testid="pr-branches">
          <span class="text-slate-500 dark:text-slate-400">{pr.baseBranch}</span>
          <span class="mx-1">←</span>
          <span>{pr.branch}</span>
        </span>
        <AuthorChip login={pr.author} />
        <ChecksSummary rollup={rollup} />
        {pr.mergeable === false && (
          <span
            class="text-[10px] font-medium uppercase tracking-wide text-red-700 dark:text-red-400"
            data-testid="pr-mergeable-conflict"
          >
            conflicts
          </span>
        )}
      </div>
      {bodyHtml && (
        <div class="border-t border-slate-100 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            class="w-full px-3 py-1.5 text-left text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50"
            data-testid="pr-body-toggle"
          >
            {expanded ? 'Hide description' : 'Show description'}
          </button>
          {expanded && (
            <div
              class="px-3 pb-3 prose prose-sm dark:prose-invert max-w-none prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-pre:rounded prose-pre:px-2 prose-pre:py-1 prose-pre:text-xs prose-code:before:content-none prose-code:after:content-none prose-code:bg-slate-100 dark:prose-code:bg-slate-800 prose-code:px-1 prose-code:rounded text-slate-700 dark:text-slate-200"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
              data-testid="pr-body"
            />
          )}
        </div>
      )}
    </section>
  )
}
