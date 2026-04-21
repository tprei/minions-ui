import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RuntimeOverrides } from '../../shared/api-types'
import { RuntimeOverridesSchema } from './schema'

function getOverridesPath(): string {
  const root = process.env['WORKSPACE_ROOT'] ?? process.cwd()
  return join(root, '.runtime-overrides.json')
}

function deepMerge(base: RuntimeOverrides, patch: Partial<RuntimeOverrides>): RuntimeOverrides {
  const result: RuntimeOverrides = { ...base }

  if (patch.loops !== undefined) {
    result.loops = { ...(base.loops ?? {}), ...patch.loops }
    for (const [key, val] of Object.entries(patch.loops)) {
      result.loops[key] = { ...(base.loops?.[key] ?? {}), ...val }
    }
  }

  if (patch.workspace !== undefined) {
    result.workspace = { ...(base.workspace ?? {}), ...patch.workspace }
  }

  if (patch.loopsConfig !== undefined) {
    result.loopsConfig = { ...(base.loopsConfig ?? {}), ...patch.loopsConfig }
  }

  if (patch.mcp !== undefined) {
    result.mcp = { ...(base.mcp ?? {}), ...patch.mcp }
  }

  if (patch.quota !== undefined) {
    result.quota = { ...(base.quota ?? {}), ...patch.quota }
  }

  return result
}

export function loadOverrides(): RuntimeOverrides {
  const path = getOverridesPath()
  if (!existsSync(path)) return {}

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }

  const parsed = RuntimeOverridesSchema.safeParse(raw)
  if (!parsed.success) return {}
  return parsed.data
}

export function saveOverrides(patch: Partial<RuntimeOverrides>): RuntimeOverrides {
  const current = loadOverrides()
  const merged = deepMerge(current, patch)

  const path = getOverridesPath()
  const tmp = `${path}.${randomUUID()}.tmp`
  writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8')
  renameSync(tmp, path)

  return merged
}
