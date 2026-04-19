import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ApiClient } from '../api/client'
import type { WorkspaceDiff } from '../api/types'
import { parseUnifiedDiff, type DiffFile, countChanges, fileDisplayPath } from './diff-parse'

interface DiffTabProps {
  sessionId: string
  sessionUpdatedAt: string
  client: ApiClient
}

export function DiffTab({ sessionId, sessionUpdatedAt, client }: DiffTabProps) {
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let cancelled = false
    setLoading(true)
    setError(null)
    client
      .getDiff(sessionId)
      .then((d) => {
        if (cancelled) return
        setDiff(d)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [sessionId, sessionUpdatedAt, client])

  const files = useMemo<DiffFile[]>(() => {
    if (!diff) return []
    return parseUnifiedDiff(diff.patch)
  }, [diff])

  const handleCopy = async () => {
    if (!diff) return
    try {
      await navigator.clipboard.writeText(diff.patch)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Failed to copy patch')
    }
  }

  if (loading && !diff) {
    return (
      <div class="flex-1 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400" data-testid="diff-loading">
        Loading diff…
      </div>
    )
  }

  if (error && !diff) {
    return (
      <div class="flex-1 flex items-center justify-center text-xs text-red-600 dark:text-red-400" data-testid="diff-error">
        {error}
      </div>
    )
  }

  if (!diff) return null

  const empty = files.length === 0 && diff.stats.filesChanged === 0

  return (
    <div class="flex flex-col flex-1 min-h-0 bg-slate-50 dark:bg-slate-900" data-testid="diff-tab">
      <div class="flex items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
        <span class="text-xs text-slate-500 dark:text-slate-400">
          <span class="font-mono text-slate-900 dark:text-slate-100">{diff.branch}</span>
          <span class="text-slate-400 dark:text-slate-500"> vs </span>
          <span class="font-mono text-slate-900 dark:text-slate-100">{diff.baseBranch}</span>
        </span>
        <span class="text-xs text-slate-500 dark:text-slate-400">
          <span class="font-semibold text-slate-700 dark:text-slate-200">{diff.stats.filesChanged}</span> files{' '}
          <span class="text-green-600 dark:text-green-400">+{diff.stats.insertions}</span>{' '}
          <span class="text-red-600 dark:text-red-400">-{diff.stats.deletions}</span>
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          class="ml-auto rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
          data-testid="diff-copy-btn"
        >
          {copied ? 'Copied' : 'Copy patch'}
        </button>
      </div>
      {diff.truncated && (
        <div class="px-4 py-1.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 shrink-0" data-testid="diff-truncated-banner">
          Diff truncated by server — view full patch on the minion or git log.
        </div>
      )}
      {empty ? (
        <div class="flex-1 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 italic" data-testid="diff-empty">
          No workspace changes.
        </div>
      ) : (
        <div class="flex-1 overflow-auto">
          {files.map((file, idx) => (
            <DiffFileView key={`${fileDisplayPath(file)}-${idx}`} file={file} />
          ))}
        </div>
      )}
    </div>
  )
}

function DiffFileView({ file }: { file: DiffFile }) {
  const [collapsed, setCollapsed] = useState(false)
  const path = fileDisplayPath(file)
  const { insertions, deletions } = countChanges(file)
  const tag = file.isNew
    ? 'NEW'
    : file.isDeleted
      ? 'DEL'
      : file.isRename
        ? 'REN'
        : file.isBinary
          ? 'BIN'
          : null

  return (
    <div class="border-b border-slate-200 dark:border-slate-700" data-testid="diff-file">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        class="w-full flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-left"
        data-testid="diff-file-toggle"
      >
        <span class="text-[10px] text-slate-500 dark:text-slate-400 w-4 inline-block">
          {collapsed ? '▸' : '▾'}
        </span>
        {tag && (
          <span class="text-[10px] uppercase tracking-wide font-semibold rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-slate-700 dark:text-slate-200">
            {tag}
          </span>
        )}
        <span class="font-mono text-xs text-slate-900 dark:text-slate-100 truncate">{path}</span>
        <span class="ml-auto text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
          <span class="text-green-600 dark:text-green-400">+{insertions}</span>{' '}
          <span class="text-red-600 dark:text-red-400">-{deletions}</span>
        </span>
      </button>
      {!collapsed && (
        <div class="font-mono text-xs bg-white dark:bg-slate-900">
          {file.isBinary && (
            <div class="px-4 py-2 text-slate-500 dark:text-slate-400 italic">Binary file.</div>
          )}
          {file.hunks.map((hunk, hi) => (
            <div key={hi}>
              <div class="px-2 sm:px-4 py-1 bg-slate-50 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400 border-y border-slate-200 dark:border-slate-700 whitespace-pre-wrap break-all">
                {hunk.header}
              </div>
              {hunk.lines.map((line, li) => {
                const bg =
                  line.type === 'add'
                    ? 'bg-green-50 dark:bg-green-950/30'
                    : line.type === 'del'
                      ? 'bg-red-50 dark:bg-red-950/30'
                      : 'bg-transparent'
                const sign = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '
                const signColor =
                  line.type === 'add'
                    ? 'text-green-700 dark:text-green-400'
                    : line.type === 'del'
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-slate-400 dark:text-slate-500'
                return (
                  <div
                    key={li}
                    class={`flex gap-2 px-2 sm:px-4 py-0.5 ${bg}`}
                    data-testid={`diff-line-${line.type}`}
                  >
                    <span class="text-[10px] text-slate-400 dark:text-slate-500 w-6 sm:w-8 text-right shrink-0 select-none">
                      {line.oldLineNo ?? ''}
                    </span>
                    <span class="hidden sm:inline text-[10px] text-slate-400 dark:text-slate-500 w-8 text-right shrink-0 select-none">
                      {line.newLineNo ?? ''}
                    </span>
                    <span class={`${signColor} w-3 shrink-0 select-none`}>{sign}</span>
                    <span class="flex-1 min-w-0 whitespace-pre-wrap break-all text-slate-800 dark:text-slate-200">
                      {line.text || ' '}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
