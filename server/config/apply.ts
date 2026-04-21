import type { RuntimeOverrides } from '../../shared/api-types'

export interface LoopRuntime {
  setInterval(id: string, ms: number): void
  enable(id: string): void
  disable(id: string): void
}

export interface AppliedResult {
  requiresRestart: string[]
}

const RESTART_FIELDS: ReadonlyArray<keyof RuntimeOverrides> = [
  'workspace',
  'loopsConfig',
]

export function requiresRestart(fields: Array<keyof RuntimeOverrides>): string[] {
  return fields.filter((f) => (RESTART_FIELDS as ReadonlyArray<string>).includes(f))
}

export function applyOverrides(
  overrides: RuntimeOverrides,
  loopRuntime?: LoopRuntime,
): AppliedResult {
  const needsRestart: string[] = []

  if (overrides.loops !== undefined && loopRuntime !== undefined) {
    for (const [id, cfg] of Object.entries(overrides.loops)) {
      if (cfg.enabled === false) {
        loopRuntime.disable(id)
      } else if (cfg.enabled === true) {
        loopRuntime.enable(id)
      }
      if (cfg.intervalMs !== undefined) {
        loopRuntime.setInterval(id, cfg.intervalMs)
      }
    }
  }

  if (overrides.workspace?.maxConcurrentSessions !== undefined) {
    needsRestart.push('workspace.maxConcurrentSessions')
  }

  if (overrides.loopsConfig?.maxConcurrentLoops !== undefined) {
    needsRestart.push('loopsConfig.maxConcurrentLoops')
  }

  return { requiresRestart: needsRestart }
}
