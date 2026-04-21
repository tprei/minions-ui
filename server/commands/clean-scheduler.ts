import type { Database } from 'bun:sqlite'
import { handleCleanCommand } from './clean'

const CLEAN_INTERVAL_MS = 60 * 60 * 1000

export function startCleanScheduler(getDb: () => Database): () => void {
  const timer = setInterval(() => {
    const db = getDb()
    handleCleanCommand(db)
  }, CLEAN_INTERVAL_MS)
  timer.unref()
  return () => clearInterval(timer)
}
