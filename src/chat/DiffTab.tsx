import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ApiClient } from '../api/client'
import type { WorkspaceDiff } from '../api/types'
import { parseUnifiedDiff, type DiffFile, countChanges, fileDisplayPath } from './diff-parse'
import { detectLanguage, highlightLine, tokenClass } from './syntax-highlight'
import { Skeleton, SkeletonLines } from '../components/Skeleton'
import {
  buildFileTree,
  type FileTreeNode,
  type FileTreeDirNode,
  type FileTreeFileNode,
} from './diff-tree'
import { useMediaQuery } from '../hooks/useMediaQuery'

interface DiffTabProps {
  sessionId: string
  sessionUpdatedAt: string
  client: ApiClient
}

type CommentMap = Record<string, string[]>

function viewedStorageKey(sessionId: string): string {
  return `minions-ui:diff-viewed:${sessionId}`
}

function commentsStorageKey(sessionId: string): string {
  return `minions-ui:diff-comments:${sessionId}`
}

function loadViewed(sessionId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(viewedStorageKey(sessionId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function saveViewed(sessionId: string, set: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(viewedStorageKey(sessionId), JSON.stringify(Array.from(set)))
  } catch {
    // best-effort persistence
  }
}

function loadComments(sessionId: string): CommentMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(commentsStorageKey(sessionId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: CommentMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
        out[k] = v as string[]
      }
    }
    return out
  } catch {
    return {}
  }
}

function saveComments(sessionId: string, comments: CommentMap): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(commentsStorageKey(sessionId), JSON.stringify(comments))
  } catch {
    // best-effort persistence
  }
}

function lineCommentKey(filePath: string, hunkIdx: number, lineIdx: number): string {
  return `${filePath}#${hunkIdx}:${lineIdx}`
}

function countCommentsForFile(comments: CommentMap, filePath: string): number {
  const prefix = `${filePath}#`
  let total = 0
  for (const [k, v] of Object.entries(comments)) {
    if (k.startsWith(prefix)) total += v.length
  }
  return total
}

export function DiffTab(props: DiffTabProps) {
  return <DiffTabInner key={props.sessionId} {...props} />
}

function DiffTabInner({ sessionId, sessionUpdatedAt, client }: DiffTabProps) {
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [commentsCopied, setCommentsCopied] = useState(false)
  const [viewed, setViewed] = useState<Set<string>>(() => loadViewed(sessionId))
  const [comments, setComments] = useState<CommentMap>(() => loadComments(sessionId))
  const [collapsedManually, setCollapsedManually] = useState<Set<string>>(new Set())

  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [treeOpen, setTreeOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia('(min-width: 1024px)').matches
  })

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map())

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

  useEffect(() => {
    saveViewed(sessionId, viewed)
  }, [sessionId, viewed])

  useEffect(() => {
    saveComments(sessionId, comments)
  }, [sessionId, comments])

  const files = useMemo<DiffFile[]>(() => {
    if (!diff) return []
    return parseUnifiedDiff(diff.patch)
  }, [diff])

  const tree = useMemo<FileTreeNode[]>(() => buildFileTree(files), [files])

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

  const handleCopyComments = async () => {
    const md = renderCommentsMarkdown(files, comments)
    if (!md) return
    try {
      await navigator.clipboard.writeText(md)
      setCommentsCopied(true)
      setTimeout(() => setCommentsCopied(false), 1500)
    } catch {
      setError('Failed to copy comments')
    }
  }

  const toggleViewed = (filePath: string) => {
    setViewed((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }

  const toggleCollapsed = (filePath: string) => {
    setCollapsedManually((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }

  const addComment = (filePath: string, hunkIdx: number, lineIdx: number, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const key = lineCommentKey(filePath, hunkIdx, lineIdx)
    setComments((prev) => {
      const next = { ...prev }
      next[key] = [...(next[key] ?? []), trimmed]
      return next
    })
  }

  const removeComment = (filePath: string, hunkIdx: number, lineIdx: number, commentIdx: number) => {
    const key = lineCommentKey(filePath, hunkIdx, lineIdx)
    setComments((prev) => {
      const existing = prev[key]
      if (!existing) return prev
      const next = { ...prev }
      const filtered = existing.filter((_, i) => i !== commentIdx)
      if (filtered.length === 0) delete next[key]
      else next[key] = filtered
      return next
    })
  }

  const scrollToFile = (filePath: string) => {
    const el = fileRefs.current.get(filePath)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    if (!isDesktop.value) setTreeOpen(false)
  }

  const registerFileRef = (filePath: string, el: HTMLDivElement | null) => {
    if (el) fileRefs.current.set(filePath, el)
    else fileRefs.current.delete(filePath)
  }

  if (loading && !diff) {
    return (
      <div class="flex-1 flex flex-col gap-3 p-3" data-testid="diff-loading">
        <div class="flex items-center gap-2">
          <Skeleton width={80} height={14} rounded="sm" />
          <Skeleton width={120} height={14} rounded="sm" />
          <Skeleton width={60} height={14} rounded="sm" class="ml-auto" />
        </div>
        <SkeletonLines count={6} lineHeight={12} />
        <SkeletonLines count={4} lineHeight={12} />
      </div>
    )
  }

  if (error && !diff) {
    return (
      <div
        class="flex-1 flex items-center justify-center text-xs text-red-600 dark:text-red-400"
        data-testid="diff-error"
      >
        {error}
      </div>
    )
  }

  if (!diff) return null

  const empty = files.length === 0 && diff.stats.filesChanged === 0
  const totalFiles = files.length
  const viewedCount = files.reduce((acc, f) => (viewed.has(fileDisplayPath(f)) ? acc + 1 : acc), 0)
  const totalCommentCount = Object.values(comments).reduce((acc, v) => acc + v.length, 0)

  return (
    <div class="flex flex-col flex-1 min-h-0 bg-slate-50 dark:bg-slate-900" data-testid="diff-tab">
      <div class="flex items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
        {!empty && (
          <button
            type="button"
            onClick={() => setTreeOpen((v) => !v)}
            aria-pressed={treeOpen}
            aria-label={treeOpen ? 'Hide file tree' : 'Show file tree'}
            class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
            data-testid="diff-tree-toggle"
          >
            Files
          </button>
        )}
        <span class="text-xs text-slate-500 dark:text-slate-400">
          <span class="font-mono text-slate-900 dark:text-slate-100">{diff.branch}</span>
          <span class="text-slate-400 dark:text-slate-500"> vs </span>
          <span class="font-mono text-slate-900 dark:text-slate-100">{diff.baseBranch}</span>
        </span>
        <span class="text-xs text-slate-500 dark:text-slate-400" data-testid="diff-stats-summary">
          <span class="text-green-600 dark:text-green-400">+{diff.stats.insertions}</span>{' '}
          <span class="text-red-600 dark:text-red-400">-{diff.stats.deletions}</span>{' '}
          <span class="text-slate-400 dark:text-slate-500">across</span>{' '}
          <span class="font-semibold text-slate-700 dark:text-slate-200">
            {diff.stats.filesChanged}
          </span>{' '}
          files
        </span>
        {totalFiles > 0 && (
          <span
            class="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline"
            data-testid="diff-stats-viewed"
          >
            <span
              class={
                viewedCount === totalFiles
                  ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                  : 'font-semibold text-slate-700 dark:text-slate-200'
              }
            >
              {viewedCount}
            </span>
            {' / '}
            {totalFiles} viewed
          </span>
        )}
        <div class="ml-auto flex items-center gap-2">
          {totalCommentCount > 0 && (
            <button
              type="button"
              onClick={() => void handleCopyComments()}
              class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
              data-testid="diff-copy-comments-btn"
            >
              {commentsCopied ? 'Copied' : `Copy ${totalCommentCount} comment${totalCommentCount === 1 ? '' : 's'}`}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCopy()}
            class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
            data-testid="diff-copy-btn"
          >
            {copied ? 'Copied' : 'Copy patch'}
          </button>
        </div>
      </div>
      {diff.truncated && (
        <div
          class="px-4 py-1.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 shrink-0"
          data-testid="diff-truncated-banner"
        >
          Diff truncated by server — view full patch on the minion or git log.
        </div>
      )}
      {empty ? (
        <div
          class="flex-1 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 italic"
          data-testid="diff-empty"
        >
          No workspace changes.
        </div>
      ) : (
        <div class="flex flex-1 min-h-0 overflow-hidden">
          {treeOpen && (
            <DiffFileTree
              tree={tree}
              viewed={viewed}
              comments={comments}
              onSelect={scrollToFile}
            />
          )}
          <div ref={scrollRef} class="flex-1 overflow-auto" data-testid="diff-scroll">
            {files.map((file, idx) => {
              const path = fileDisplayPath(file)
              const isViewed = viewed.has(path)
              const isManuallyCollapsed = collapsedManually.has(path)
              const collapsed = isManuallyCollapsed || isViewed
              return (
                <DiffFileView
                  key={`${path}-${idx}`}
                  file={file}
                  filePath={path}
                  collapsed={collapsed}
                  viewed={isViewed}
                  comments={comments}
                  onToggleCollapsed={() => toggleCollapsed(path)}
                  onToggleViewed={() => toggleViewed(path)}
                  onAddComment={addComment}
                  onRemoveComment={removeComment}
                  registerRef={registerFileRef}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

interface DiffFileTreeProps {
  tree: FileTreeNode[]
  viewed: Set<string>
  comments: CommentMap
  onSelect: (filePath: string) => void
}

function DiffFileTree({ tree, viewed, comments, onSelect }: DiffFileTreeProps) {
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  const toggleDir = (path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  return (
    <aside
      class="w-56 sm:w-64 shrink-0 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-auto py-2"
      data-testid="diff-tree"
      aria-label="Files changed"
    >
      <ul class="text-xs">
        {tree.map((node) => (
          <TreeNodeRow
            key={node.path}
            node={node}
            depth={0}
            viewed={viewed}
            comments={comments}
            collapsedDirs={collapsedDirs}
            onSelect={onSelect}
            onToggleDir={toggleDir}
          />
        ))}
      </ul>
    </aside>
  )
}

interface TreeNodeRowProps {
  node: FileTreeNode
  depth: number
  viewed: Set<string>
  comments: CommentMap
  collapsedDirs: Set<string>
  onSelect: (filePath: string) => void
  onToggleDir: (path: string) => void
}

function TreeNodeRow({
  node,
  depth,
  viewed,
  comments,
  collapsedDirs,
  onSelect,
  onToggleDir,
}: TreeNodeRowProps) {
  const indentStyle = { paddingLeft: `${depth * 12 + 8}px` }
  if (node.kind === 'dir') {
    const dir = node as FileTreeDirNode
    const collapsed = collapsedDirs.has(dir.path)
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggleDir(dir.path)}
          style={indentStyle}
          class="w-full flex items-center gap-1 py-0.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200"
          data-testid="diff-tree-dir"
        >
          <span class="text-[10px] text-slate-400 dark:text-slate-500 w-3 inline-block">
            {collapsed ? '▸' : '▾'}
          </span>
          <span class="truncate font-medium">{dir.name}/</span>
        </button>
        {!collapsed && (
          <ul>
            {dir.children.map((child) => (
              <TreeNodeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                viewed={viewed}
                comments={comments}
                collapsedDirs={collapsedDirs}
                onSelect={onSelect}
                onToggleDir={onToggleDir}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }
  const file = node as FileTreeFileNode
  const isViewed = viewed.has(file.path)
  const { insertions, deletions } = countChanges(file.file)
  const commentCount = countCommentsForFile(comments, file.path)
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(file.path)}
        style={indentStyle}
        class={
          'w-full flex items-center gap-1 py-0.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700/60 ' +
          (isViewed
            ? 'text-slate-400 dark:text-slate-500 line-through'
            : 'text-slate-800 dark:text-slate-100')
        }
        data-testid="diff-tree-file"
        data-file-path={file.path}
      >
        <span class="text-[10px] text-slate-400 dark:text-slate-500 w-3 inline-block" aria-hidden="true" />
        <span class="truncate flex-1">{file.name}</span>
        {commentCount > 0 && (
          <span
            class="text-[10px] rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 px-1"
            data-testid="diff-tree-file-comments"
            aria-label={`${commentCount} comment${commentCount === 1 ? '' : 's'}`}
          >
            {commentCount}
          </span>
        )}
        <span class="text-[10px] whitespace-nowrap">
          <span class="text-green-600 dark:text-green-400">+{insertions}</span>{' '}
          <span class="text-red-600 dark:text-red-400">-{deletions}</span>
        </span>
      </button>
    </li>
  )
}

interface DiffFileViewProps {
  file: DiffFile
  filePath: string
  collapsed: boolean
  viewed: boolean
  comments: CommentMap
  onToggleCollapsed: () => void
  onToggleViewed: () => void
  onAddComment: (filePath: string, hunkIdx: number, lineIdx: number, text: string) => void
  onRemoveComment: (filePath: string, hunkIdx: number, lineIdx: number, commentIdx: number) => void
  registerRef: (filePath: string, el: HTMLDivElement | null) => void
}

function DiffFileView({
  file,
  filePath,
  collapsed,
  viewed,
  comments,
  onToggleCollapsed,
  onToggleViewed,
  onAddComment,
  onRemoveComment,
  registerRef,
}: DiffFileViewProps) {
  const lang = detectLanguage(filePath)
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
    <div
      ref={(el) => registerRef(filePath, el)}
      class="border-b border-slate-200 dark:border-slate-700"
      data-testid="diff-file"
      data-file-path={filePath}
    >
      <div
        class={
          'sticky top-0 z-10 flex items-center gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-700 ' +
          (viewed
            ? 'bg-emerald-50 dark:bg-emerald-950/40'
            : 'bg-slate-100 dark:bg-slate-800')
        }
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          class="flex items-center gap-2 flex-1 min-w-0 text-left hover:opacity-80"
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
          <span
            class={
              'font-mono text-xs truncate ' +
              (viewed
                ? 'text-slate-500 dark:text-slate-400 line-through'
                : 'text-slate-900 dark:text-slate-100')
            }
          >
            {filePath}
          </span>
          <span class="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
            <span class="text-green-600 dark:text-green-400">+{insertions}</span>{' '}
            <span class="text-red-600 dark:text-red-400">-{deletions}</span>
          </span>
        </button>
        <label
          class="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer select-none whitespace-nowrap"
          data-testid="diff-file-viewed-label"
        >
          <input
            type="checkbox"
            checked={viewed}
            onChange={onToggleViewed}
            class="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-600"
            data-testid="diff-file-viewed"
            aria-label={`Mark ${filePath} as viewed`}
          />
          Viewed
        </label>
      </div>
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
                const key = lineCommentKey(filePath, hi, li)
                const lineComments = comments[key] ?? []
                return (
                  <LineRow
                    key={li}
                    line={line}
                    lang={lang}
                    comments={lineComments}
                    onAddComment={(text) => onAddComment(filePath, hi, li, text)}
                    onRemoveComment={(idx) => onRemoveComment(filePath, hi, li, idx)}
                  />
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface LineRowProps {
  line: { type: 'add' | 'del' | 'context'; text: string; oldLineNo?: number; newLineNo?: number }
  lang: string | null
  comments: string[]
  onAddComment: (text: string) => void
  onRemoveComment: (commentIdx: number) => void
}

function LineRow({ line, lang, comments, onAddComment, onRemoveComment }: LineRowProps) {
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')

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

  const submit = () => {
    const text = draft.trim()
    if (!text) {
      setComposing(false)
      return
    }
    onAddComment(text)
    setDraft('')
    setComposing(false)
  }

  const cancel = () => {
    setDraft('')
    setComposing(false)
  }

  return (
    <div class="group/line">
      <div class={`flex gap-2 px-2 sm:px-4 py-0.5 ${bg}`} data-testid={`diff-line-${line.type}`}>
        <span class="text-[10px] text-slate-400 dark:text-slate-500 w-6 sm:w-8 text-right shrink-0 select-none">
          {line.oldLineNo ?? ''}
        </span>
        <span class="hidden sm:inline text-[10px] text-slate-400 dark:text-slate-500 w-8 text-right shrink-0 select-none">
          {line.newLineNo ?? ''}
        </span>
        <button
          type="button"
          onClick={() => setComposing(true)}
          aria-label="Add comment"
          class="hidden group-hover/line:inline-flex items-center justify-center w-4 h-4 -my-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold shrink-0"
          data-testid="diff-comment-add-btn"
        >
          +
        </button>
        <span class={`${signColor} w-3 shrink-0 select-none`}>{sign}</span>
        <span class="flex-1 min-w-0 whitespace-pre-wrap break-all text-slate-800 dark:text-slate-200">
          <HighlightedCode text={line.text} lang={lang} />
        </span>
      </div>
      {(comments.length > 0 || composing) && (
        <div class="border-l-2 border-indigo-300 dark:border-indigo-700 bg-indigo-50/40 dark:bg-indigo-950/20 ml-12 sm:ml-20 px-3 py-2 my-1 rounded-r">
          {comments.map((c, idx) => (
            <div
              key={idx}
              class="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200 mb-1 last:mb-0"
              data-testid="diff-comment"
            >
              <span class="flex-1 whitespace-pre-wrap break-words font-sans">{c}</span>
              <button
                type="button"
                onClick={() => onRemoveComment(idx)}
                aria-label="Delete comment"
                class="text-[10px] text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                data-testid="diff-comment-delete"
              >
                ✕
              </button>
            </div>
          ))}
          {composing && (
            <div class="flex flex-col gap-1.5 mt-1">
              <textarea
                value={draft}
                onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    submit()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancel()
                  }
                }}
                placeholder="Leave a comment…"
                rows={2}
                class="w-full text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-sans"
                data-testid="diff-comment-input"
                autofocus
              />
              <div class="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={cancel}
                  class="text-[11px] px-2 py-0.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                  data-testid="diff-comment-cancel"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={draft.trim().length === 0}
                  class="text-[11px] px-2 py-0.5 rounded bg-indigo-600 text-white font-medium disabled:opacity-50 hover:bg-indigo-700"
                  data-testid="diff-comment-submit"
                >
                  Comment
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HighlightedCode({ text, lang }: { text: string; lang: string | null }) {
  if (!text) return <>{' '}</>
  if (!lang) return <>{text}</>
  const tokens = highlightLine(text, lang)
  return (
    <>
      {tokens.map((tok, idx) => {
        const cls = tokenClass(tok.type)
        if (!cls) return <span key={idx}>{tok.text}</span>
        return (
          <span key={idx} class={cls}>
            {tok.text}
          </span>
        )
      })}
    </>
  )
}

function renderCommentsMarkdown(files: DiffFile[], comments: CommentMap): string {
  const blocks: string[] = []
  for (const file of files) {
    const path = fileDisplayPath(file)
    const prefix = `${path}#`
    file.hunks.forEach((hunk, hi) => {
      hunk.lines.forEach((line, li) => {
        const key = `${prefix}${hi}:${li}`
        const list = comments[key]
        if (!list || list.length === 0) return
        const lineNo = line.newLineNo ?? line.oldLineNo ?? '?'
        const sign = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '
        blocks.push(`**${path}:${lineNo}**\n\`\`\`\n${sign}${line.text}\n\`\`\`\n${list.join('\n\n')}`)
      })
    })
  }
  return blocks.join('\n\n---\n\n')
}
