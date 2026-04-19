import type { WorkspaceDiffStats } from './types'

// Parse a unified-diff patch and count files changed plus insertions/deletions.
// Filters the per-file header lines (`+++ ` / `--- `) so they don't inflate the
// insertion/deletion counts. Mirrors `git diff --shortstat` closely enough for
// UI summaries; exact counts near binary-diff boundaries are best-effort.
export function computeDiffStats(patch: string): WorkspaceDiffStats {
  if (!patch) return { filesChanged: 0, insertions: 0, deletions: 0 }

  let filesChanged = 0
  let insertions = 0
  let deletions = 0

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      filesChanged++
    } else if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      continue
    } else if (line.startsWith('+')) {
      insertions++
    } else if (line.startsWith('-')) {
      deletions++
    }
  }

  return { filesChanged, insertions, deletions }
}
