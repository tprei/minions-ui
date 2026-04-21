import { useMemo, useState } from 'preact/hooks'
import { useComputed } from '@preact/signals'
import type { ApiSession, MinionCommand } from '../api/types'
import type { ConnectionStore } from '../state/types'
import { Transcript, TranscriptUpgradeNotice } from '../chat/transcript'
import { confirm } from '../hooks/useConfirm'
import { hasFeature } from '../api/features'
import { formatRoute } from '../routing/route'
import { variantGroupsSignal, setVariantWinner } from './store'
import type { VariantGroup } from './types'

interface VariantGroupViewProps {
  store: ConnectionStore
  groupId: string
  navigate?: (hash: string) => void
}

function defaultNavigate(hash: string): void {
  if (typeof window !== 'undefined') {
    window.location.hash = hash
  }
}

function statusDot(status: ApiSession['status']): string {
  if (status === 'running') return 'bg-blue-500 animate-pulse'
  if (status === 'completed') return 'bg-green-500'
  if (status === 'failed') return 'bg-red-500'
  return 'bg-slate-400'
}

export function VariantGroupView({ store, groupId, navigate = defaultNavigate }: VariantGroupViewProps) {
  const groupsSignal = useMemo(() => variantGroupsSignal(store.connectionId), [store.connectionId])
  const groupSignal = useComputed<VariantGroup | null>(
    () => groupsSignal.value.find((g) => g.groupId === groupId) ?? null
  )
  const group = groupSignal.value
  const allSessions = store.sessions.value

  const featureOn = hasFeature(store, 'sessions-variants')

  if (!featureOn) {
    return (
      <div
        class="flex-1 flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-900"
        data-testid="variant-group-gated"
      >
        <div class="text-center text-sm text-slate-500 dark:text-slate-400 max-w-md">
          <div class="font-semibold text-slate-700 dark:text-slate-300 mb-1">Parallel variants unavailable</div>
          <div>This connection's library does not support variant groups. Needs library ≥ 1.111.</div>
          <button
            type="button"
            onClick={() => navigate(formatRoute({ name: 'home' }))}
            class="mt-3 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
            data-testid="variant-group-back"
          >
            ← Back
          </button>
        </div>
      </div>
    )
  }

  if (!group) {
    return (
      <div
        class="flex-1 flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-900"
        data-testid="variant-group-missing"
      >
        <div class="text-center text-sm text-slate-500 dark:text-slate-400 max-w-md">
          <div class="font-semibold text-slate-700 dark:text-slate-300 mb-1">Variant group not found</div>
          <div>
            Group <code class="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">{groupId}</code>{' '}
            isn't recorded for this connection.
          </div>
          <button
            type="button"
            onClick={() => navigate(formatRoute({ name: 'home' }))}
            class="mt-3 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
            data-testid="variant-group-back"
          >
            ← Back
          </button>
        </div>
      </div>
    )
  }

  const variants: Array<{ id: string; session: ApiSession | null }> = group.variantSessionIds.map((id) => ({
    id,
    session: allSessions.find((s) => s.id === id) ?? null,
  }))

  return (
    <div class="flex flex-col flex-1 min-h-0 bg-white dark:bg-slate-800" data-testid="variant-group-view">
      <VariantGroupHeader group={group} onBack={() => navigate(formatRoute({ name: 'home' }))} />
      <VariantColumns
        store={store}
        group={group}
        variants={variants}
        navigate={navigate}
      />
    </div>
  )
}

function VariantGroupHeader({ group, onBack }: { group: VariantGroup; onBack: () => void }) {
  return (
    <header
      class="flex flex-col gap-1 px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0 bg-slate-50 dark:bg-slate-900"
      data-testid="variant-group-header"
    >
      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
          data-testid="variant-group-back"
        >
          ← Back
        </button>
        <span class="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Variants</span>
        <span class="font-mono text-xs text-slate-600 dark:text-slate-300">{group.groupId}</span>
        <span class="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{group.mode}</span>
        {group.repo && (
          <span class="text-[10px] font-mono rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-slate-600 dark:text-slate-300">
            {group.repo}
          </span>
        )}
        <span class="ml-auto text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          ×{group.variantSessionIds.length}
        </span>
      </div>
      <div
        class="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words"
        data-testid="variant-group-prompt"
      >
        {group.prompt}
      </div>
    </header>
  )
}

interface VariantColumnsProps {
  store: ConnectionStore
  group: VariantGroup
  variants: Array<{ id: string; session: ApiSession | null }>
  navigate: (hash: string) => void
}

function VariantColumns({ store, group, variants, navigate }: VariantColumnsProps) {
  const pickWinner = async (winner: ApiSession) => {
    const siblings = variants.filter((v) => v.id !== winner.id)
    const siblingCount = siblings.length
    const ok = await confirm({
      title: `Pick ${winner.slug} as winner?`,
      message:
        siblingCount > 0
          ? `Stops the other ${siblingCount} sibling session${siblingCount === 1 ? '' : 's'}. The winner keeps running and is promoted to the normal session list.`
          : 'Promotes this session to the normal list.',
      destructive: true,
      confirmLabel: 'Pick winner',
    })
    if (!ok) return

    for (const sib of siblings) {
      if (!sib.session) continue
      const s = sib.session
      if (s.status === 'running' || s.status === 'pending') {
        await store.sendCommand({ action: 'stop', sessionId: s.id } satisfies MinionCommand)
      }
      if (s.status !== 'completed' && s.status !== 'failed') {
        await store.sendCommand({ action: 'close', sessionId: s.id } satisfies MinionCommand)
        store.applySessionDeleted(s.id)
      }
    }

    setVariantWinner(store.connectionId, group.groupId, winner.id)
    navigate(formatRoute({ name: 'session', sessionSlug: winner.slug }))
  }

  return (
    <div
      class="flex-1 grid gap-px bg-slate-200 dark:bg-slate-700 overflow-hidden md:overflow-x-auto"
      style={{
        gridTemplateColumns: `repeat(${Math.max(variants.length, 1)}, minmax(320px, 1fr))`,
      }}
      data-testid="variant-columns"
    >
      {variants.map((v) => (
        <VariantColumn
          key={v.id}
          id={v.id}
          session={v.session}
          group={group}
          store={store}
          onPickWinner={pickWinner}
          onOpen={() => {
            if (v.session) navigate(formatRoute({ name: 'session', sessionSlug: v.session.slug }))
          }}
        />
      ))}
    </div>
  )
}

interface VariantColumnProps {
  id: string
  session: ApiSession | null
  group: VariantGroup
  store: ConnectionStore
  onPickWinner: (s: ApiSession) => Promise<void>
  onOpen: () => void
}

function VariantColumn({ id, session, group, store, onPickWinner, onOpen }: VariantColumnProps) {
  const [picking, setPicking] = useState(false)
  const isWinner = group.winnerId === id
  const winnerLocked = typeof group.winnerId === 'string'

  return (
    <section
      class={`flex flex-col min-h-0 min-w-0 bg-white dark:bg-slate-800 ${isWinner ? 'ring-2 ring-inset ring-indigo-500' : ''}`}
      data-testid={`variant-column-${id}`}
      data-winner={isWinner ? 'true' : 'false'}
    >
      <div class="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 shrink-0">
        {session ? (
          <>
            <span class={`inline-block h-2 w-2 rounded-full ${statusDot(session.status)}`} />
            <button
              type="button"
              onClick={onOpen}
              class="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 truncate hover:underline"
              data-testid={`variant-open-${id}`}
            >
              {session.slug}
            </button>
            <span class="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {session.status}
            </span>
          </>
        ) : (
          <>
            <span class="inline-block h-2 w-2 rounded-full bg-slate-400" />
            <span class="font-mono text-xs text-slate-500 dark:text-slate-400 truncate">waiting…</span>
          </>
        )}
        <button
          type="button"
          disabled={!session || picking || winnerLocked}
          onClick={async () => {
            if (!session) return
            setPicking(true)
            try {
              await onPickWinner(session)
            } finally {
              setPicking(false)
            }
          }}
          title={
            winnerLocked
              ? isWinner
                ? 'Already picked'
                : 'Winner already chosen'
              : 'Stop siblings and promote this session'
          }
          class={`ml-auto rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            isWinner
              ? 'bg-indigo-600 border-indigo-700 text-white'
              : 'border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
          }`}
          data-testid={`variant-pick-${id}`}
        >
          {isWinner ? 'Winner' : picking ? 'Picking…' : 'Pick winner'}
        </button>
      </div>
      <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
        {session ? (
          <VariantTranscript store={store} session={session} />
        ) : (
          <div class="flex-1 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500 italic p-6">
            Variant hasn't landed yet.
          </div>
        )}
      </div>
    </section>
  )
}

function VariantTranscript({ store, session }: { store: ConnectionStore; session: ApiSession }) {
  if (!hasFeature(store, 'transcript')) {
    return <TranscriptUpgradeNotice store={store} />
  }
  const transcript = store.getTranscript(session.id)
  if (!transcript) {
    return (
      <div class="flex-1 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500 italic p-6">
        Transcript unavailable.
      </div>
    )
  }
  return <Transcript store={transcript} />
}
