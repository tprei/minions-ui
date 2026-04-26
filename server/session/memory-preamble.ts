import type { Database } from 'bun:sqlite'
import { listMemories, type MemoryRow } from '../db/memories'

export interface MemoryPreambleOpts {
  db: Database
  repo: string | null
}

/**
 * Builds the memory preamble for agent prompts.
 * Returns [pinned verbatim memories] + [terse approved index].
 */
export function buildMemoryPreamble(opts: MemoryPreambleOpts): string {
  const { db, repo } = opts

  // Fetch pinned approved memories (full content)
  const pinnedMemories = listMemories(db, {
    repo,
    status: 'approved',
  }).filter((m) => m.pinned)

  // Fetch non-pinned approved memories (terse index)
  const indexMemories = listMemories(db, {
    repo,
    status: 'approved',
  }).filter((m) => !m.pinned)

  if (pinnedMemories.length === 0 && indexMemories.length === 0) {
    return ''
  }

  const parts: string[] = []

  parts.push('# Repo memory')
  parts.push('')

  if (pinnedMemories.length > 0) {
    parts.push('## Pinned memories')
    parts.push('')
    for (const mem of pinnedMemories) {
      parts.push(`### ${mem.title}`)
      parts.push('')
      parts.push(mem.body)
      parts.push('')
      parts.push(`_Kind: ${mem.kind} | Source: ${formatSource(mem)} | Created: ${formatDate(mem.created_at)}_`)
      parts.push('')
    }
  }

  if (indexMemories.length > 0) {
    parts.push('## Memory index')
    parts.push('')
    parts.push('| ID | Kind | Title | Source | Created |')
    parts.push('|----|------|-------|--------|---------|')
    for (const mem of indexMemories) {
      const source = formatSource(mem)
      const created = formatDate(mem.created_at)
      parts.push(`| ${mem.id} | ${mem.kind} | ${mem.title} | ${source} | ${created} |`)
    }
    parts.push('')
  }

  return parts.join('\n')
}

function formatSource(mem: MemoryRow): string {
  if (mem.source_session_id) {
    return mem.source_session_id.slice(0, 8)
  }
  return '—'
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().split('T')[0] ?? '—'
}
