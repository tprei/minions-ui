import { useEffect, useMemo, useRef } from 'preact/hooks'
import type { ApiDagGraph, ApiDagNode, ApiSession, FeedbackMetadata } from '../api/types'
import { useTheme } from '../hooks/useTheme'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useSwipeToDismiss } from '../hooks/useSwipeToDismiss'
import { StatusBadge, AttentionBadge, formatRelativeTime } from './shared'
import { PrLink } from './PrLink'

interface NodeDetailPopupProps {
  session: ApiSession
  onClose: () => void
  onOpenChat?: (sessionId: string) => void
  onViewLogs?: (sessionId: string) => void
  sessions?: ApiSession[]
  dags?: ApiDagGraph[]
  onSelectSession?: (session: ApiSession) => void
  onRetryRebase?: (dagId: string, nodeId: string) => Promise<void>
}

function MetaRow({ label, children, isDark }: { label: string; children: preact.ComponentChildren; isDark: boolean }) {
  return (
    <div class="flex items-start gap-2 text-xs">
      <span class="shrink-0 w-16 font-medium" style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>
        {label}
      </span>
      <span class="min-w-0 flex-1" style={{ color: isDark ? '#e5e7eb' : '#374151' }}>
        {children}
      </span>
    </div>
  )
}

interface SessionLinkProps {
  session: ApiSession
  onClick?: (session: ApiSession) => void
  isDark: boolean
}

function SessionLink({ session, onClick, isDark }: SessionLinkProps) {
  const linkColor = isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
  if (!onClick) {
    return <span class="font-mono text-[11px] truncate">{session.slug}</span>
  }
  return (
    <button
      type="button"
      onClick={(e: Event) => {
        e.stopPropagation()
        onClick(session)
      }}
      class={`font-mono text-[11px] truncate hover:underline cursor-pointer bg-transparent border-0 p-0 ${linkColor}`}
      data-testid={`node-detail-session-link-${session.id}`}
    >
      {session.slug}
    </button>
  )
}

function findOwningDag(
  sessionId: string,
  dags: ApiDagGraph[] | undefined,
): { dag: ApiDagGraph; node: ApiDagNode } | null {
  if (!dags) return null
  for (const dag of dags) {
    for (const node of Object.values(dag.nodes)) {
      if (node.session?.id === sessionId || node.id === sessionId) {
        return { dag, node }
      }
    }
  }
  return null
}

function isFeedbackSession(session: ApiSession): session is ApiSession & { metadata: FeedbackMetadata } {
  return session.metadata !== undefined &&
    typeof session.metadata === 'object' &&
    'kind' in session.metadata &&
    session.metadata.kind === 'feedback'
}

function FeedbackBadge({ isDark }: { isDark: boolean }) {
  return (
    <span
      class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{
        backgroundColor: isDark ? 'rgba(251,191,36,0.2)' : 'rgba(245,158,11,0.15)',
        color: isDark ? '#fbbf24' : '#d97706',
      }}
      data-testid="feedback-badge"
    >
      Feedback
    </span>
  )
}

export function NodeDetailPopup({
  session,
  onClose,
  onOpenChat,
  onViewLogs,
  sessions,
  dags,
  onSelectSession,
  onRetryRebase,
}: NodeDetailPopupProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const isMobile = useMediaQuery('(max-width: 767px)')
  const popupRef = useRef<HTMLDivElement>(null)
  const swipeRef = useSwipeToDismiss({
    onDismiss: onClose,
    threshold: 100,
    enabled: isMobile.value,
  })

  useEffect(() => {
    if (isMobile.value && popupRef.current) {
      swipeRef.current = popupRef.current
    }
  }, [isMobile.value, swipeRef])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const sessionById = useMemo(() => {
    const map = new Map<string, ApiSession>()
    if (sessions) {
      for (const s of sessions) map.set(s.id, s)
    }
    return map
  }, [sessions])

  const parentSession = session.parentId ? sessionById.get(session.parentId) : undefined
  const childSessions = useMemo(() => {
    const result: ApiSession[] = []
    for (const id of session.childIds) {
      const child = sessionById.get(id)
      if (child) result.push(child)
    }
    return result
  }, [session.childIds, sessionById])

  const dagMatch = useMemo(() => findOwningDag(session.id, dags), [session.id, dags])
  const dagNodeStatus = dagMatch?.node.status
  const dagNodeError = dagMatch?.node.error
  const showDagStatus = dagNodeStatus && dagNodeStatus !== session.status
  const isRebaseConflict = dagNodeStatus === 'rebase-conflict'
  const isRebasing = dagNodeStatus === 'rebasing'

  const isShipCoordinator = session.mode === 'ship'

  const overlayBg = isDark ? 'bg-black/70' : 'bg-black/50'
  const dialogBg = isDark ? 'bg-gray-800' : 'bg-white'
  const titleColor = isDark ? 'text-white' : 'text-gray-900'
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200'
  const secondaryBg = isDark ? 'bg-gray-700/50' : 'bg-gray-50'
  const mutedText = isDark ? 'text-gray-400' : 'text-gray-500'

  const truncatedPrompt = session.command.length > 200
    ? session.command.slice(0, 200) + '...'
    : session.command

  const hasChatAction = Boolean(onOpenChat)
  const hasLogsAction = Boolean(onViewLogs)

  const feedbackMeta = isFeedbackSession(session) ? session.metadata : null
  const sourceSession = feedbackMeta ? sessionById.get(feedbackMeta.sourceSessionId) : undefined

  const hasHierarchyMeta =
    feedbackMeta !== null ||
    parentSession !== undefined ||
    childSessions.length > 0 ||
    dagMatch !== null ||
    (isShipCoordinator && session.stage !== undefined)

  if (isMobile.value) {
    return (
      <div class="fixed inset-0 z-50">
        <div class={`absolute inset-0 ${overlayBg}`} onClick={onClose} />
        <div
          ref={popupRef}
          class={`absolute bottom-0 left-0 right-0 ${dialogBg} rounded-t-2xl shadow-xl flex flex-col max-h-[90dvh]`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="node-detail-title"
        >
          <div class="flex justify-center pt-2 pb-1 shrink-0">
            <div class={`w-10 h-1 rounded-full ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`} />
          </div>
          <div class="overflow-y-auto flex-1">
            <div class={`px-4 pt-3 pb-3 border-b ${borderColor}`}>
              <div class="flex items-center justify-between gap-2">
                <h3 id="node-detail-title" class={`text-base font-semibold ${titleColor} truncate`}>
                  {session.slug}
                </h3>
                <button
                  onClick={onClose}
                  class={`shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                  aria-label="Close"
                >
                  <span class="text-lg leading-none">&times;</span>
                </button>
              </div>
              <div class="flex items-center gap-2 mt-1.5">
                <StatusBadge status={session.status} />
                {isFeedbackSession(session) && <FeedbackBadge isDark={isDark} />}
                {session.needsAttention && session.attentionReasons.length > 0 && (
                  <AttentionBadge reason={session.attentionReasons[0]} darkMode={isDark} />
                )}
              </div>
            </div>

            {session.command && (
              <div class={`px-4 py-3 border-b ${borderColor}`}>
                <div class={`text-[11px] font-medium uppercase tracking-wide mb-1.5 ${mutedText}`}>Prompt</div>
                <div
                  class={`text-xs leading-relaxed rounded-lg p-2.5 ${secondaryBg}`}
                  style={{ color: isDark ? '#d1d5db' : '#4b5563' }}
                >
                  {truncatedPrompt}
                </div>
              </div>
            )}

            {hasHierarchyMeta && (
              <div class={`px-4 py-3 border-b ${borderColor} flex flex-col gap-2`} data-testid="node-detail-hierarchy">
                {feedbackMeta && (
                  <MetaRow label="Reviewing" isDark={isDark}>
                    <div class="flex flex-col gap-1">
                      <div class="flex items-center gap-2">
                        <span>{feedbackMeta.vote === 'up' ? '👍' : '👎'}</span>
                        {feedbackMeta.reason && (
                          <span class="text-xs">
                            {feedbackMeta.reason === 'incorrect' ? 'Incorrect' :
                             feedbackMeta.reason === 'off_topic' ? 'Off Topic' :
                             feedbackMeta.reason === 'too_verbose' ? 'Too Verbose' :
                             feedbackMeta.reason === 'unsafe' ? 'Unsafe' : 'Other'}
                          </span>
                        )}
                      </div>
                      {sourceSession && (
                        <SessionLink session={sourceSession} onClick={onSelectSession} isDark={isDark} />
                      )}
                      {feedbackMeta.comment && (
                        <span class="text-[11px] opacity-70 italic">{feedbackMeta.comment}</span>
                      )}
                    </div>
                  </MetaRow>
                )}
                {isShipCoordinator && session.stage && (
                  <MetaRow label="Stage" isDark={isDark}>
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: isDark ? 'rgba(167,139,250,0.2)' : 'rgba(124,58,237,0.1)',
                        color: isDark ? '#a78bfa' : '#7c3aed',
                      }}
                      data-testid="node-detail-ship-stage"
                    >
                      {session.stage}
                    </span>
                  </MetaRow>
                )}
                {parentSession && (
                  <MetaRow label="Parent" isDark={isDark}>
                    <SessionLink session={parentSession} onClick={onSelectSession} isDark={isDark} />
                  </MetaRow>
                )}
                {childSessions.length > 0 && !isShipCoordinator && (
                  <MetaRow label={childSessions.length === 1 ? 'Child' : 'Children'} isDark={isDark}>
                    <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {childSessions.map((child, i) => (
                        <span key={child.id} class="inline-flex items-center">
                          <SessionLink session={child} onClick={onSelectSession} isDark={isDark} />
                          {i < childSessions.length - 1 && (
                            <span class="ml-2" style={{ color: isDark ? '#4b5563' : '#d1d5db' }}>·</span>
                          )}
                        </span>
                      ))}
                    </span>
                  </MetaRow>
                )}
                {childSessions.length > 0 && isShipCoordinator && (
                  <MetaRow label="Workers" isDark={isDark}>
                    <div class="flex flex-col gap-1">
                      {childSessions.map((child) => (
                        <div key={child.id} class="flex items-center gap-2">
                          <SessionLink session={child} onClick={onSelectSession} isDark={isDark} />
                          <StatusBadge status={child.status} />
                        </div>
                      ))}
                    </div>
                  </MetaRow>
                )}
                {dagMatch && (
                  <MetaRow label="DAG" isDark={isDark}>
                    <span class="font-mono text-[11px] truncate block" data-testid="node-detail-dag-id">
                      {dagMatch.dag.id}
                    </span>
                  </MetaRow>
                )}
                {dagMatch && showDagStatus && (
                  <MetaRow label="DAG node" isDark={isDark}>
                    <span data-testid="node-detail-dag-node-status">
                      <StatusBadge status={dagNodeStatus!} />
                    </span>
                  </MetaRow>
                )}
              </div>
            )}

            {isRebaseConflict && dagNodeError && (
              <div
                class={`mx-4 mt-3 mb-3 px-3 py-2.5 rounded-lg border ${isDark ? 'bg-amber-900/20 border-amber-700/50' : 'bg-amber-50 border-amber-200'}`}
                data-testid="node-detail-rebase-error"
              >
                <div class={`text-xs font-medium mb-1 ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>
                  Rebase Conflict
                </div>
                <div class={`text-xs leading-relaxed ${isDark ? 'text-amber-200/90' : 'text-amber-900/90'}`}>
                  {dagNodeError}
                </div>
              </div>
            )}

            {isRebasing && (
              <div
                class={`mx-4 mt-3 mb-3 px-3 py-2.5 rounded-lg border ${isDark ? 'bg-indigo-900/20 border-indigo-700/50' : 'bg-indigo-50 border-indigo-200'}`}
                data-testid="node-detail-rebasing-status"
              >
                <div class="flex items-center gap-2">
                  <span class="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  <span class={`text-xs font-medium ${isDark ? 'text-indigo-300' : 'text-indigo-800'}`}>
                    Rebasing in progress...
                  </span>
                </div>
              </div>
            )}

            <div class={`px-4 py-3 border-b ${borderColor} flex flex-col gap-2`}>
              {session.repo && (
                <MetaRow label="Repo" isDark={isDark}>
                  <span class="truncate block">{session.repo}</span>
                </MetaRow>
              )}
              {session.branch && (
                <MetaRow label="Branch" isDark={isDark}>
                  <span class="truncate block font-mono text-[11px]">{session.branch}</span>
                </MetaRow>
              )}
              {session.prUrl && (
                <MetaRow label="PR" isDark={isDark}>
                  <div onClick={(e: Event) => e.stopPropagation()}>
                    <PrLink prUrl={session.prUrl} />
                  </div>
                </MetaRow>
              )}
              {session.mode && (
                <MetaRow label="Mode" isDark={isDark}>
                  {session.mode}
                </MetaRow>
              )}
              <MetaRow label="Created" isDark={isDark}>
                {formatRelativeTime(session.createdAt)}
              </MetaRow>
              <MetaRow label="Updated" isDark={isDark}>
                {formatRelativeTime(session.updatedAt)}
              </MetaRow>
            </div>

            <div class="px-4 py-3 flex flex-wrap gap-2">
              {isRebaseConflict && onRetryRebase && dagMatch && (
                <button
                  onClick={() => onRetryRebase!(dagMatch.dag.id, dagMatch.node.id)}
                  class={`flex-1 min-w-[8rem] flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium rounded-lg transition-colors min-h-[44px] ${isDark ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-amber-500 hover:bg-amber-600 text-white'}`}
                  data-testid="node-detail-retry-rebase-btn"
                >
                  <span>Retry Rebase</span>
                </button>
              )}
              {hasChatAction && (
                <button
                  onClick={() => onOpenChat!(session.id)}
                  class={`flex-1 min-w-[8rem] flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium rounded-lg transition-colors min-h-[44px] ${isDark ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
                >
                  <span>Open Chat</span>
                </button>
              )}
              {hasLogsAction && (
                <button
                  onClick={() => onViewLogs!(session.id)}
                  class={`flex-1 min-w-[8rem] flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium rounded-lg transition-colors min-h-[44px] ${isDark ? 'bg-slate-700 hover:bg-slate-600 text-slate-100' : 'bg-slate-100 hover:bg-slate-200 text-slate-800'}`}
                  data-testid="node-detail-view-logs-btn"
                >
                  <span>View Logs</span>
                </button>
              )}
              {session.prUrl && (
                <button
                  onClick={() => window.open(session.prUrl!, '_blank', 'noopener,noreferrer')}
                  class={`flex-1 min-w-[8rem] flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium rounded-lg transition-colors min-h-[44px] ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'}`}
                >
                  <span>View PR</span>
                </button>
              )}
              {!isRebaseConflict && !hasChatAction && !hasLogsAction && !session.prUrl && (
                <div class={`flex-1 text-center text-sm py-2 ${mutedText}`}>
                  No actions available
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div class="fixed inset-y-0 right-0 z-50 flex pointer-events-none">
      <div
        ref={popupRef}
        data-anim="slide-in-right"
        data-testid="node-detail-slideover"
        class={`relative ${dialogBg} w-full sm:w-[24rem] md:w-[26rem] h-full shadow-2xl border-l ${borderColor} pointer-events-auto overflow-y-auto`}
        role="dialog"
        aria-labelledby="node-detail-title"
      >
        <div class={`px-4 pt-4 pb-3 border-b ${borderColor}`}>
          <div class="flex items-center justify-between gap-2">
            <h3 id="node-detail-title" class={`text-base font-semibold ${titleColor} truncate`}>
              {session.slug}
            </h3>
            <button
              onClick={onClose}
              class={`shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
              aria-label="Close"
            >
              <span class="text-lg leading-none">&times;</span>
            </button>
          </div>
          <div class="flex items-center gap-2 mt-1.5">
            <StatusBadge status={session.status} />
            {isFeedbackSession(session) && <FeedbackBadge isDark={isDark} />}
            {session.needsAttention && session.attentionReasons.length > 0 && (
              <AttentionBadge reason={session.attentionReasons[0]} darkMode={isDark} />
            )}
          </div>
        </div>

        {session.command && (
          <div class={`px-4 py-3 border-b ${borderColor}`}>
            <div class={`text-[11px] font-medium uppercase tracking-wide mb-1.5 ${mutedText}`}>Prompt</div>
            <div
              class={`text-xs leading-relaxed rounded-lg p-2.5 ${secondaryBg}`}
              style={{ color: isDark ? '#d1d5db' : '#4b5563' }}
            >
              {truncatedPrompt}
            </div>
          </div>
        )}

        {hasHierarchyMeta && (
          <div class={`px-4 py-3 border-b ${borderColor} flex flex-col gap-2`} data-testid="node-detail-hierarchy">
            {feedbackMeta && (
              <MetaRow label="Reviewing" isDark={isDark}>
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-2">
                    <span>{feedbackMeta.vote === 'up' ? '👍' : '👎'}</span>
                    {feedbackMeta.reason && (
                      <span class="text-xs">
                        {feedbackMeta.reason === 'incorrect' ? 'Incorrect' :
                         feedbackMeta.reason === 'off_topic' ? 'Off Topic' :
                         feedbackMeta.reason === 'too_verbose' ? 'Too Verbose' :
                         feedbackMeta.reason === 'unsafe' ? 'Unsafe' : 'Other'}
                      </span>
                    )}
                  </div>
                  {sourceSession && (
                    <SessionLink session={sourceSession} onClick={onSelectSession} isDark={isDark} />
                  )}
                  {feedbackMeta.comment && (
                    <span class="text-[11px] opacity-70 italic">{feedbackMeta.comment}</span>
                  )}
                </div>
              </MetaRow>
            )}
            {isShipCoordinator && session.stage && (
              <MetaRow label="Stage" isDark={isDark}>
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  style={{
                    backgroundColor: isDark ? 'rgba(167,139,250,0.2)' : 'rgba(124,58,237,0.1)',
                    color: isDark ? '#a78bfa' : '#7c3aed',
                  }}
                  data-testid="node-detail-ship-stage"
                >
                  {session.stage}
                </span>
              </MetaRow>
            )}
            {parentSession && (
              <MetaRow label="Parent" isDark={isDark}>
                <SessionLink session={parentSession} onClick={onSelectSession} isDark={isDark} />
              </MetaRow>
            )}
            {childSessions.length > 0 && !isShipCoordinator && (
              <MetaRow label={childSessions.length === 1 ? 'Child' : 'Children'} isDark={isDark}>
                <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {childSessions.map((child, i) => (
                    <span key={child.id} class="inline-flex items-center">
                      <SessionLink session={child} onClick={onSelectSession} isDark={isDark} />
                      {i < childSessions.length - 1 && (
                        <span class="ml-2" style={{ color: isDark ? '#4b5563' : '#d1d5db' }}>·</span>
                      )}
                    </span>
                  ))}
                </span>
              </MetaRow>
            )}
            {childSessions.length > 0 && isShipCoordinator && (
              <MetaRow label="Workers" isDark={isDark}>
                <div class="flex flex-col gap-1">
                  {childSessions.map((child) => (
                    <div key={child.id} class="flex items-center gap-2">
                      <SessionLink session={child} onClick={onSelectSession} isDark={isDark} />
                      <StatusBadge status={child.status} />
                    </div>
                  ))}
                </div>
              </MetaRow>
            )}
            {dagMatch && (
              <MetaRow label="DAG" isDark={isDark}>
                <span class="font-mono text-[11px] truncate block" data-testid="node-detail-dag-id">
                  {dagMatch.dag.id}
                </span>
              </MetaRow>
            )}
            {dagMatch && showDagStatus && (
              <MetaRow label="DAG node" isDark={isDark}>
                <span data-testid="node-detail-dag-node-status">
                  <StatusBadge status={dagNodeStatus!} />
                </span>
              </MetaRow>
            )}
          </div>
        )}

        {isRebaseConflict && dagNodeError && (
          <div
            class={`mx-4 mt-3 mb-3 px-3 py-2.5 rounded-lg border ${isDark ? 'bg-amber-900/20 border-amber-700/50' : 'bg-amber-50 border-amber-200'}`}
            data-testid="node-detail-rebase-error"
          >
            <div class={`text-xs font-medium mb-1 ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>
              Rebase Conflict
            </div>
            <div class={`text-xs leading-relaxed ${isDark ? 'text-amber-200/90' : 'text-amber-900/90'}`}>
              {dagNodeError}
            </div>
          </div>
        )}

        {isRebasing && (
          <div
            class={`mx-4 mt-3 mb-3 px-3 py-2.5 rounded-lg border ${isDark ? 'bg-indigo-900/20 border-indigo-700/50' : 'bg-indigo-50 border-indigo-200'}`}
            data-testid="node-detail-rebasing-status"
          >
            <div class="flex items-center gap-2">
              <span class="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <span class={`text-xs font-medium ${isDark ? 'text-indigo-300' : 'text-indigo-800'}`}>
                Rebasing in progress...
              </span>
            </div>
          </div>
        )}

        <div class={`px-4 py-3 border-b ${borderColor} flex flex-col gap-2`}>
          {session.repo && (
            <MetaRow label="Repo" isDark={isDark}>
              <span class="truncate block">{session.repo}</span>
            </MetaRow>
          )}
          {session.branch && (
            <MetaRow label="Branch" isDark={isDark}>
              <span class="truncate block font-mono text-[11px]">{session.branch}</span>
            </MetaRow>
          )}
          {session.prUrl && (
            <MetaRow label="PR" isDark={isDark}>
              <div onClick={(e: Event) => e.stopPropagation()}>
                <PrLink prUrl={session.prUrl} />
              </div>
            </MetaRow>
          )}
          {session.mode && (
            <MetaRow label="Mode" isDark={isDark}>
              {session.mode}
            </MetaRow>
          )}
          <MetaRow label="Created" isDark={isDark}>
            {formatRelativeTime(session.createdAt)}
          </MetaRow>
          <MetaRow label="Updated" isDark={isDark}>
            {formatRelativeTime(session.updatedAt)}
          </MetaRow>
        </div>

        <div class="px-4 py-3 flex flex-wrap gap-2">
          {isRebaseConflict && onRetryRebase && dagMatch && (
            <button
              onClick={() => onRetryRebase!(dagMatch.dag.id, dagMatch.node.id)}
              class={`flex-1 min-w-[8rem] flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium rounded-lg transition-colors min-h-[44px] ${isDark ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-amber-500 hover:bg-amber-600 text-white'}`}
              data-testid="node-detail-retry-rebase-btn"
            >
              <span>Retry Rebase</span>
            </button>
          )}
          {hasChatAction && (
            <button
              onClick={() => onOpenChat!(session.id)}
              class={`flex-1 min-w-[8rem] flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium rounded-lg transition-colors min-h-[44px] ${isDark ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
            >
              <span>Open Chat</span>
            </button>
          )}
          {hasLogsAction && (
            <button
              onClick={() => onViewLogs!(session.id)}
              class={`flex-1 min-w-[8rem] flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium rounded-lg transition-colors min-h-[44px] ${isDark ? 'bg-slate-700 hover:bg-slate-600 text-slate-100' : 'bg-slate-100 hover:bg-slate-200 text-slate-800'}`}
              data-testid="node-detail-view-logs-btn"
            >
              <span>View Logs</span>
            </button>
          )}
          {session.prUrl && (
            <button
              onClick={() => window.open(session.prUrl!, '_blank', 'noopener,noreferrer')}
              class={`flex-1 min-w-[8rem] flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium rounded-lg transition-colors min-h-[44px] ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'}`}
            >
              <span>View PR</span>
            </button>
          )}
          {!isRebaseConflict && !hasChatAction && !hasLogsAction && !session.prUrl && (
            <div class={`flex-1 text-center text-sm py-2 ${mutedText}`}>
              No actions available
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
