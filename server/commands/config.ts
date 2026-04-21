import { loadOverrides, saveOverrides } from '../config/runtime-overrides'
import type { RuntimeOverrides } from '../../shared/api-types'

export interface ConfigCommandResult {
  ok: boolean
  text?: string
  overrides?: RuntimeOverrides
  error?: string
}

function parseKeyValue(raw: string): { key: string; rawValue: string } | null {
  const eqIdx = raw.indexOf('=')
  if (eqIdx < 1) return null
  return { key: raw.slice(0, eqIdx).trim(), rawValue: raw.slice(eqIdx + 1).trim() }
}

function applyDotPath(
  root: Record<string, unknown>,
  dotKey: string,
  rawValue: string,
): void {
  const parts = dotKey.split('.')
  let cursor: Record<string, unknown> = root
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!
    if (typeof cursor[p] !== 'object' || cursor[p] === null) {
      cursor[p] = {}
    }
    cursor = cursor[p] as Record<string, unknown>
  }
  const last = parts[parts.length - 1]!
  if (rawValue === 'true') cursor[last] = true
  else if (rawValue === 'false') cursor[last] = false
  else if (/^-?\d+$/.test(rawValue)) cursor[last] = parseInt(rawValue, 10)
  else cursor[last] = rawValue
}

export function handleConfigCommand(subArgs: string): ConfigCommandResult {
  const parts = subArgs.trim().split(/\s+/)
  const sub = parts[0] ?? 'show'

  if (sub === 'show' || sub === '') {
    const overrides = loadOverrides()
    return {
      ok: true,
      text: JSON.stringify(overrides, null, 2),
      overrides,
    }
  }

  if (sub === 'set') {
    const rest = parts.slice(1).join(' ')
    if (!rest) return { ok: false, error: 'usage: /config set key=value' }

    const parsed = parseKeyValue(rest)
    if (!parsed) return { ok: false, error: `invalid format; expected key=value, got: ${rest}` }

    const patch: Record<string, unknown> = {}
    applyDotPath(patch, parsed.key, parsed.rawValue)

    const merged = saveOverrides(patch as Partial<RuntimeOverrides>)
    return { ok: true, text: `Set ${parsed.key} = ${parsed.rawValue}`, overrides: merged }
  }

  return { ok: false, error: `unknown config subcommand: ${sub}. Use show or set key=value` }
}
