import type { LoopDefinition } from './definitions'

export interface RunHistoryEntry {
  ranAt: number
  state: string
  prUrl?: string
}

export function buildLoopPrompt(
  def: LoopDefinition,
  runHistory: RunHistoryEntry[],
  existingPrUrl?: string,
): string {
  const parts: string[] = []

  parts.push(`# ${def.title}`)
  parts.push('')
  parts.push(def.promptTemplate)

  parts.push('')
  parts.push('## Branch and PR instructions')
  parts.push('')
  parts.push(
    `Before creating a PR, check whether a PR already exists on branch \`${def.branchPrefix}\`. ` +
      `If yes, push to that branch and let the existing PR auto-update. ` +
      `If no, open a new PR on that branch.`,
  )

  if (existingPrUrl) {
    parts.push('')
    parts.push(`An existing PR for this loop is open at: ${existingPrUrl}`)
    parts.push(`Push your changes to branch \`${def.branchPrefix}\` to update it.`)
  }

  if (runHistory.length > 0) {
    parts.push('')
    parts.push('## Previous runs')
    parts.push('')
    parts.push('Do not repeat fixes that were already applied in earlier runs:')
    for (const entry of runHistory) {
      const date = new Date(entry.ranAt).toISOString()
      const prNote = entry.prUrl ? ` (PR: ${entry.prUrl})` : ''
      parts.push(`- ${date}: ${entry.state}${prNote}`)
    }
  }

  parts.push('')
  parts.push('## Constraints')
  parts.push('')
  parts.push('- Do not add any post-task routing or task orchestration artifacts.')
  parts.push('- Make your changes, run quality checks, then open or update the PR.')

  return parts.join('\n')
}
