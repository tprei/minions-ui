import type { ConnectionStore } from '../state/types'

interface Props {
  store: ConnectionStore
  onOpen?: () => void
}

export function ResourceChip({ store, onOpen }: Props) {
  const snap = store.resourceSnapshot.value
  if (!snap) {
    return (
      <button
        type="button"
        onClick={onOpen}
        class="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 h-7 px-2 flex items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
        data-testid="resource-chip"
        title="Resource metrics — waiting for first snapshot"
      >
        <span class="inline-block h-2 w-2 rounded-full bg-slate-400" />
        <span class="hidden sm:inline">waiting…</span>
      </button>
    )
  }
  const cpuPct = snap.cpu.usagePercent
  const memPct = snap.memory.limitBytes > 0 ? (snap.memory.usedBytes / snap.memory.limitBytes) * 100 : 0
  const worst = Math.max(cpuPct, memPct)
  const dot =
    worst >= 85 ? 'bg-red-500'
    : worst >= 50 ? 'bg-amber-500'
    : 'bg-green-500'

  const memLabel = formatBytesCompact(snap.memory.usedBytes) + '/' + formatBytesCompact(snap.memory.limitBytes)

  const titleLines = [
    `CPU ${cpuPct.toFixed(0)}% (${snap.cpu.cpuCount} × ${snap.cpu.source})`,
    `Mem ${memLabel} (${snap.memory.source})`,
    `Disk ${formatBytesCompact(snap.disk.usedBytes)}/${formatBytesCompact(snap.disk.totalBytes)}`,
    `Loop lag ${snap.eventLoopLagMs.toFixed(1)}ms`,
    `Sessions ${snap.counts.activeSessions}/${snap.counts.maxSessions}`,
    `Loops ${snap.counts.activeLoops}/${snap.counts.maxLoops}`,
  ].join('\n')

  return (
    <button
      type="button"
      onClick={onOpen}
      class="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 h-7 px-2 flex items-center gap-1.5 text-[10px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 tabular-nums"
      data-testid="resource-chip"
      title={titleLines}
      aria-label="Open resource metrics"
    >
      <span class={`inline-block h-2 w-2 rounded-full ${dot}`} />
      <span class="hidden sm:inline">{cpuPct.toFixed(0)}%</span>
      <span class="hidden md:inline text-slate-400 dark:text-slate-500">·</span>
      <span class="hidden md:inline">{memPct.toFixed(0)}%</span>
    </button>
  )
}

function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
