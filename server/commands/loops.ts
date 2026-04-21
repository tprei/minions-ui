import type { Database } from 'bun:sqlite'
import { listLoops, setLoopEnabled, getLoop } from '../loops/store'

export interface LoopsCommandResult {
  ok: boolean
  text?: string
  loops?: Array<{ id: string; enabled: boolean; intervalMs: number }>
  error?: string
}

export function handleLoopsCommand(subArgs: string, db: Database): LoopsCommandResult {
  const parts = subArgs.trim().split(/\s+/)
  const sub = parts[0] ?? 'list'

  if (sub === 'list' || sub === '') {
    const rows = listLoops(db)
    const lines = rows.map((r) => `${r.enabled ? '[on] ' : '[off]'} ${r.id}  (interval: ${r.interval_ms}ms)`)
    return {
      ok: true,
      text: lines.length > 0 ? lines.join('\n') : 'No loops defined',
      loops: rows.map((r) => ({ id: r.id, enabled: r.enabled, intervalMs: r.interval_ms })),
    }
  }

  if (sub === 'enable' || sub === 'disable') {
    const id = parts[1]
    if (!id) return { ok: false, error: `usage: /loops ${sub} <id>` }

    const existing = getLoop(db, id)
    if (!existing) return { ok: false, error: `loop ${id} not found` }

    const enabled = sub === 'enable'
    setLoopEnabled(db, id, enabled)
    return { ok: true, text: `Loop ${id} ${enabled ? 'enabled' : 'disabled'}` }
  }

  return { ok: false, error: `unknown loops subcommand: ${sub}. Use list, enable <id>, or disable <id>` }
}
