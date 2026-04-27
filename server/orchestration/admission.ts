export type SessionPriority =
  | 'interactive'
  | 'ship-root'
  | 'ship-verify'
  | 'dag-task'
  | 'loop'

export const PRIORITY_ORDER: readonly SessionPriority[] = [
  'interactive',
  'ship-root',
  'ship-verify',
  'dag-task',
  'loop',
] as const

const PRIORITY_RANK: Record<SessionPriority, number> = {
  interactive: 0,
  'ship-root': 1,
  'ship-verify': 2,
  'dag-task': 3,
  loop: 4,
}

export interface AdmissionConfig {
  totalCap: number
  reservedSlots: Record<SessionPriority, number>
}

export interface AdmissionDecision {
  admitted: boolean
  reason?: string
  priority: SessionPriority
  capForPriority: number
  active: number
  activeAtOrBelow: number
}

export interface AdmissionStats {
  total: number
  byPriority: Record<SessionPriority, number>
}

export interface PriorityResolutionInput {
  mode: string
  metadata?: Record<string, unknown> | null
  stage?: string | null
}

export class AdmissionDeniedError extends Error {
  readonly priority: SessionPriority
  readonly capForPriority: number
  readonly active: number

  constructor(decision: AdmissionDecision) {
    super(decision.reason ?? `admission denied for priority ${decision.priority}`)
    this.name = 'AdmissionDeniedError'
    this.priority = decision.priority
    this.capForPriority = decision.capForPriority
    this.active = decision.active
  }
}

export function priorityForMode(input: PriorityResolutionInput): SessionPriority {
  const meta = input.metadata ?? undefined
  if (meta && typeof meta === 'object' && 'loopId' in meta && typeof meta.loopId === 'string') {
    return 'loop'
  }
  if (input.mode === 'dag-task') return 'dag-task'
  if (input.mode === 'ship') {
    if (input.stage === 'verify') return 'ship-verify'
    return 'ship-root'
  }
  return 'interactive'
}

export interface AdmissionController {
  tryAdmit(sessionId: string, priority: SessionPriority): AdmissionDecision
  peek(priority: SessionPriority): AdmissionDecision
  release(sessionId: string): SessionPriority | undefined
  reserve(sessionId: string, priority: SessionPriority): void
  active(): number
  stats(): AdmissionStats
  capForPriority(priority: SessionPriority): number
  setTotalCap(n: number): void
  setReservedSlots(reserved: Partial<Record<SessionPriority, number>>): void
  config(): AdmissionConfig
}

export interface AdmissionControllerOpts {
  totalCap: number
  reservedSlots?: Partial<Record<SessionPriority, number>>
}

const DEFAULT_RESERVED: Record<SessionPriority, number> = {
  interactive: 2,
  'ship-root': 1,
  'ship-verify': 0,
  'dag-task': 0,
  loop: 0,
}

function normalizeReserved(
  partial: Partial<Record<SessionPriority, number>> | undefined,
): Record<SessionPriority, number> {
  const result = { ...DEFAULT_RESERVED }
  if (!partial) return result
  for (const key of PRIORITY_ORDER) {
    const v = partial[key]
    if (v !== undefined) {
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(`reservedSlots[${key}] must be a non-negative number`)
      }
      result[key] = Math.floor(v)
    }
  }
  return result
}

export function createAdmissionController(opts: AdmissionControllerOpts): AdmissionController {
  if (!Number.isFinite(opts.totalCap) || opts.totalCap < 1) {
    throw new Error('totalCap must be a positive number')
  }

  let totalCap = Math.floor(opts.totalCap)
  let reservedSlots = normalizeReserved(opts.reservedSlots)
  const sessions = new Map<string, SessionPriority>()
  const counts: Record<SessionPriority, number> = {
    interactive: 0,
    'ship-root': 0,
    'ship-verify': 0,
    'dag-task': 0,
    loop: 0,
  }

  function reservedForHigherThan(priority: SessionPriority): number {
    const rank = PRIORITY_RANK[priority]
    let total = 0
    for (const p of PRIORITY_ORDER) {
      if (PRIORITY_RANK[p] < rank) total += reservedSlots[p]
    }
    return total
  }

  function capForPriority(priority: SessionPriority): number {
    const cap = totalCap - reservedForHigherThan(priority)
    return Math.max(0, cap)
  }

  function totalActive(): number {
    let s = 0
    for (const p of PRIORITY_ORDER) s += counts[p]
    return s
  }

  function activeAtOrBelow(priority: SessionPriority): number {
    const rank = PRIORITY_RANK[priority]
    let s = 0
    for (const p of PRIORITY_ORDER) {
      if (PRIORITY_RANK[p] >= rank) s += counts[p]
    }
    return s
  }

  function evaluate(priority: SessionPriority): AdmissionDecision {
    const cap = capForPriority(priority)
    const atOrBelow = activeAtOrBelow(priority)
    const active = totalActive()
    if (atOrBelow + 1 > cap) {
      const reason =
        `admission denied: priority "${priority}" cap is ${cap} ` +
        `(total ${totalCap}, reserved-above ${reservedForHigherThan(priority)}); ` +
        `${atOrBelow} session(s) at or below this priority already running`
      return { admitted: false, reason, priority, capForPriority: cap, active, activeAtOrBelow: atOrBelow }
    }
    return { admitted: true, priority, capForPriority: cap, active, activeAtOrBelow: atOrBelow }
  }

  function tryAdmit(sessionId: string, priority: SessionPriority): AdmissionDecision {
    if (sessions.has(sessionId)) {
      const existing = sessions.get(sessionId)!
      return {
        admitted: true,
        priority: existing,
        capForPriority: capForPriority(existing),
        active: totalActive(),
        activeAtOrBelow: activeAtOrBelow(existing),
      }
    }
    const decision = evaluate(priority)
    if (decision.admitted) {
      sessions.set(sessionId, priority)
      counts[priority] += 1
    }
    return decision
  }

  function reserve(sessionId: string, priority: SessionPriority): void {
    if (sessions.has(sessionId)) return
    sessions.set(sessionId, priority)
    counts[priority] += 1
  }

  function release(sessionId: string): SessionPriority | undefined {
    const priority = sessions.get(sessionId)
    if (!priority) return undefined
    sessions.delete(sessionId)
    counts[priority] = Math.max(0, counts[priority] - 1)
    return priority
  }

  function active(): number {
    return totalActive()
  }

  function stats(): AdmissionStats {
    return {
      total: totalActive(),
      byPriority: { ...counts },
    }
  }

  function setTotalCap(n: number): void {
    if (!Number.isFinite(n) || n < 1) throw new Error('totalCap must be a positive number')
    totalCap = Math.floor(n)
  }

  function setReservedSlots(reserved: Partial<Record<SessionPriority, number>>): void {
    reservedSlots = normalizeReserved({ ...reservedSlots, ...reserved })
  }

  function config(): AdmissionConfig {
    return { totalCap, reservedSlots: { ...reservedSlots } }
  }

  function peek(priority: SessionPriority): AdmissionDecision {
    return evaluate(priority)
  }

  return {
    tryAdmit,
    peek,
    release,
    reserve,
    active,
    stats,
    capForPriority,
    setTotalCap,
    setReservedSlots,
    config,
  }
}
