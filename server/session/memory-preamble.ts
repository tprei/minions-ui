import type { Database } from 'bun:sqlite'
import { listMemories, type MemoryRow } from '../db/memories'

export interface MemoryPreambleOpts {
  repo: string
  maxApprovedInIndex?: number
  pinnedMemoryIds?: string[]
}

export function buildMemoryPreamble(db: Database, opts: MemoryPreambleOpts): string {
  const { repo, maxApprovedInIndex = 50, pinnedMemoryIds = [] } = opts

  const pinnedMemories: MemoryRow[] = []
  for (const id of pinnedMemoryIds) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND status = ?').get(id, 'approved') as MemoryRow | null
    if (memory) pinnedMemories.push(memory)
  }

  const approvedMemories = listMemories(db, { repo, status: 'approved', limit: maxApprovedInIndex })

  const sections: string[] = []

  if (pinnedMemories.length > 0) {
    sections.push('## Pinned memories\n')
    for (const m of pinnedMemories) {
      sections.push(`### ${m.name}`)
      sections.push(m.description)
      sections.push('')
      sections.push(m.content)
      sections.push('')
    }
  }

  if (approvedMemories.length > 0) {
    sections.push('## Approved memory index\n')
    sections.push('The following memories are approved for this repo. Use the memory MCP tools to search and load full content when relevant.\n')
    for (const m of approvedMemories) {
      sections.push(`- **${m.name}** [${m.type}]: ${m.description}`)
    }
    sections.push('')
  }

  if (sections.length === 0) {
    return ''
  }

  return `# Repo memory\n\n${sections.join('\n')}`
}
