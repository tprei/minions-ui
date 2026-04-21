import type { ResourceSnapshot } from '../api/types'

interface Props {
  snapshot: ResourceSnapshot | null
}

export function ResourcePanel({ snapshot }: Props) {
  if (!snapshot) {
    return (
      <div class="p-4 text-sm text-slate-500 dark:text-slate-400" data-testid="resource-panel-empty">
        Waiting for the first snapshot…
      </div>
    )
  }

  const cpuPct = snapshot.cpu.usagePercent
  const memPct = snapshot.memory.limitBytes > 0
    ? (snapshot.memory.usedBytes / snapshot.memory.limitBytes) * 100
    : 0
  const diskPct = snapshot.disk.totalBytes > 0
    ? (snapshot.disk.usedBytes / snapshot.disk.totalBytes) * 100
    : 0

  return (
    <div class="p-4 space-y-4" data-testid="resource-panel">
      <Bar
        label="CPU"
        percent={cpuPct}
        suffix={`${cpuPct.toFixed(1)}% of ${snapshot.cpu.cpuCount} ${snapshot.cpu.cpuCount === 1 ? 'core' : 'cores'} (${snapshot.cpu.source})`}
      />
      <Bar
        label="Memory"
        percent={memPct}
        suffix={`${formatBytes(snapshot.memory.usedBytes)} / ${formatBytes(snapshot.memory.limitBytes)} (${snapshot.memory.source === 'cgroup' ? 'container limit' : 'no container limit — host total'})`}
      />
      <Bar
        label={`Disk (${snapshot.disk.path})`}
        percent={diskPct}
        suffix={`${formatBytes(snapshot.disk.usedBytes)} / ${formatBytes(snapshot.disk.totalBytes)}`}
      />

      <dl class="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Process RSS" value={formatBytes(snapshot.memory.rssBytes)} />
        <Stat label="Event-loop lag" value={`${snapshot.eventLoopLagMs.toFixed(2)} ms`} />
        <Stat
          label="Active sessions"
          value={`${snapshot.counts.activeSessions} / ${snapshot.counts.maxSessions}`}
        />
        <Stat
          label="Active loops"
          value={`${snapshot.counts.activeLoops} / ${snapshot.counts.maxLoops}`}
        />
      </dl>

      <div class="text-[10px] text-slate-500 dark:text-slate-400">
        Last update: {new Date(snapshot.ts).toLocaleTimeString()}
      </div>
    </div>
  )
}

function Bar({ label, percent, suffix }: { label: string; percent: number; suffix: string }) {
  const clamped = Math.max(0, Math.min(100, percent))
  const color =
    clamped >= 85 ? 'bg-red-500'
    : clamped >= 50 ? 'bg-amber-500'
    : 'bg-green-500'
  return (
    <div>
      <div class="flex items-center justify-between text-xs text-slate-700 dark:text-slate-200 mb-1">
        <span class="font-medium">{label}</span>
        <span class="text-slate-500 dark:text-slate-400 tabular-nums">{suffix}</span>
      </div>
      <div class="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div
          class={`h-full ${color} transition-all`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div class="flex flex-col gap-0.5 rounded-md border border-slate-200 dark:border-slate-700 p-2">
      <dt class="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd class="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ${units[unit]}`
}
