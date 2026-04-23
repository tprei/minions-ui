import fs from 'node:fs'
import os from 'node:os'
import type { EngineEventBus } from '../events/bus'
import type { CountsSnapshot, ResourceSnapshot } from '../../shared/api-types'

interface CpuStatCgroup {
  usageUsec: number
}

function readCgroupCpuStat(): CpuStatCgroup | null {
  try {
    const raw = fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8')
    const line = raw.split('\n').find((l) => l.startsWith('usage_usec '))
    if (!line) return null
    const parts = line.split(' ')
    const val = parts[1] !== undefined ? Number(parts[1]) : NaN
    if (!isFinite(val)) return null
    return { usageUsec: val }
  } catch {
    return null
  }
}

function readCgroupMemory(): { current: number; max: number } | null {
  try {
    const current = Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim())
    const maxRaw = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim()
    const max = maxRaw === 'max' ? Number.MAX_SAFE_INTEGER : Number(maxRaw)
    if (!isFinite(current) || !isFinite(max)) return null
    return { current, max }
  } catch {
    return null
  }
}

function readCgroupCpuMax(): number | null {
  try {
    const raw = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim()
    const [quota, period] = raw.split(/\s+/)
    if (!quota || !period || quota === 'max') return null
    const q = Number(quota)
    const p = Number(period)
    if (!isFinite(q) || !isFinite(p) || p <= 0) return null
    return q / p
  } catch {
    return null
  }
}

interface ProcStatSnapshot {
  idle: number
  total: number
}

function readProcStat(): ProcStatSnapshot | null {
  try {
    const raw = fs.readFileSync('/proc/stat', 'utf8')
    const line = raw.split('\n').find((l) => l.startsWith('cpu '))
    if (!line) return null
    const parts = line.trim().split(/\s+/)
    const nums = parts.slice(1).map(Number)
    const idle = (nums[3] ?? 0) + (nums[4] ?? 0)
    const total = nums.reduce((a, b) => a + b, 0)
    return { idle, total }
  } catch {
    return null
  }
}

function readProcMeminfo(): { used: number; total: number } | null {
  try {
    const raw = fs.readFileSync('/proc/meminfo', 'utf8')
    function parseKb(key: string): number {
      const line = raw.split('\n').find((l) => l.startsWith(key))
      if (!line) return 0
      const match = /(\d+)\s+kB/.exec(line)
      return match && match[1] ? Number(match[1]) * 1024 : 0
    }
    const total = parseKb('MemTotal:')
    const free = parseKb('MemFree:')
    const buffers = parseKb('Buffers:')
    const cached = parseKb('Cached:')
    const used = total - free - buffers - cached
    return { used, total }
  } catch {
    return null
  }
}

function readDisk(p: string): { usedBytes: number; totalBytes: number } {
  try {
    const stats = fs.statfsSync(p)
    const blockSize = Number(stats.bsize)
    const total = Number(stats.blocks) * blockSize
    const free = Number(stats.bavail) * blockSize
    return { usedBytes: Math.max(0, total - free), totalBytes: total }
  } catch {
    return { usedBytes: 0, totalBytes: 0 }
  }
}

export type CountsProvider = () => CountsSnapshot

export interface ResourceMonitorOpts {
  intervalMs?: number
  diskPath?: string
  countsProvider?: CountsProvider
}

const DEFAULT_COUNTS: CountsSnapshot = {
  activeSessions: 0,
  maxSessions: 0,
  activeLoops: 0,
  maxLoops: 0,
}

export class ResourceMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  private lagTimer: ReturnType<typeof setInterval> | null = null
  private prevCgroupUsec: number | null = null
  private prevProcStat: ProcStatSnapshot | null = null
  private prevTs: number | null = null
  private lastEventLoopLagMs = 0
  private readonly intervalMs: number
  private readonly diskPath: string
  private readonly countsProvider: CountsProvider

  constructor(
    private readonly bus: EngineEventBus,
    opts: number | ResourceMonitorOpts = {},
  ) {
    if (typeof opts === 'number') {
      this.intervalMs = opts
      this.diskPath = '/'
      this.countsProvider = () => DEFAULT_COUNTS
    } else {
      this.intervalMs = opts.intervalMs ?? 1000
      this.diskPath = opts.diskPath ?? '/'
      this.countsProvider = opts.countsProvider ?? (() => DEFAULT_COUNTS)
    }
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.tick(), this.intervalMs)
    this.lagTimer = setInterval(() => this.measureLag(), 500)
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.lagTimer !== null) {
      clearInterval(this.lagTimer)
      this.lagTimer = null
    }
  }

  private measureLag(): void {
    const start = process.hrtime.bigint()
    setImmediate(() => {
      const elapsedNs = Number(process.hrtime.bigint() - start)
      this.lastEventLoopLagMs = elapsedNs / 1e6
    })
  }

  private tick(): void {
    const snapshot = this.sample(Date.now())
    this.bus.emit({ kind: 'resource' as const, snapshot })
  }

  sample(now: number): ResourceSnapshot {
    const cgroupMem = readCgroupMemory()
    const cgroupCpu = readCgroupCpuStat()

    let cpuPct = 0
    let memUsed = 0
    let memLimit = 0
    let memSource: 'cgroup' | 'host' = 'host'
    let cpuSource: 'cgroup' | 'host' = 'host'

    if (cgroupMem) {
      memUsed = cgroupMem.current
      memLimit = cgroupMem.max
      memSource = 'cgroup'
    } else {
      const proc = readProcMeminfo()
      if (proc) {
        memUsed = proc.used
        memLimit = proc.total
      }
    }

    if (cgroupCpu) {
      cpuSource = 'cgroup'
      if (this.prevCgroupUsec !== null && this.prevTs !== null) {
        const usecDelta = cgroupCpu.usageUsec - this.prevCgroupUsec
        const msDelta = now - this.prevTs
        cpuPct = msDelta > 0 ? (usecDelta / 1000 / msDelta) * 100 : 0
      }
      this.prevCgroupUsec = cgroupCpu.usageUsec
    } else {
      const procStat = readProcStat()
      if (procStat) {
        if (this.prevProcStat !== null) {
          const idleDelta = procStat.idle - this.prevProcStat.idle
          const totalDelta = procStat.total - this.prevProcStat.total
          cpuPct = totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : 0
        }
        this.prevProcStat = procStat
      }
    }

    this.prevTs = now

    const cpuCount = readCgroupCpuMax() ?? os.cpus().length
    const disk = readDisk(this.diskPath)
    const counts = this.countsProvider()
    const rssBytes = process.memoryUsage().rss

    return {
      ts: now,
      cpu: {
        usagePercent: Math.max(0, Math.min(100, cpuPct)),
        cpuCount,
        source: cpuSource,
      },
      memory: {
        usedBytes: memUsed,
        limitBytes: memLimit,
        rssBytes,
        source: memSource,
      },
      disk: { path: this.diskPath, ...disk },
      eventLoopLagMs: this.lastEventLoopLagMs,
      counts,
    }
  }
}
