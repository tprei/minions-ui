import type { Database } from 'bun:sqlite'
import { handleStatsCommand, type StatsCommandResult } from './stats'

export function handleUsageCommand(db: Database): StatsCommandResult {
  const now = new Date()
  const daysIntoMonth = now.getDate()
  return handleStatsCommand(daysIntoMonth, db)
}
