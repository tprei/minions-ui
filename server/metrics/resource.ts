import fs from 'node:fs'
import type { EngineEventBus } from '../events/bus'

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

export interface ResourceMetrics {
  kind: 'resource'
  cpuPct: number
  memBytes: number
  memMaxBytes: number
  timestamp: number
}

export class ResourceMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  private prevCgroupUsec: number | null = null
  private prevProcStat: ProcStatSnapshot | null = null
  private prevTs: number | null = null

  constructor(
    private readonly bus: EngineEventBus,
    private readonly intervalMs = 1000,
  ) {}

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.tick(), this.intervalMs)
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private tick(): void {
    const now = Date.now()
    const metrics = this.sample(now)
    this.bus.emit({
      kind: 'resource' as const,
      ...metrics,
    })
  }

  sample(now: number): Omit<ResourceMetrics, 'kind'> {
    const cgroupMem = readCgroupMemory()
    const cgroupCpu = readCgroupCpuStat()

    let cpuPct = 0
    let memBytes = 0
    let memMaxBytes = 0

    if (cgroupMem) {
      memBytes = cgroupMem.current
      memMaxBytes = cgroupMem.max
    } else {
      const proc = readProcMeminfo()
      if (proc) {
        memBytes = proc.used
        memMaxBytes = proc.total
      }
    }

    if (cgroupCpu) {
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

    return {
      cpuPct: Math.max(0, Math.min(100, cpuPct)),
      memBytes,
      memMaxBytes,
      timestamp: now,
    }
  }
}
