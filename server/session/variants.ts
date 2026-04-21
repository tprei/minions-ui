import { randomUUID } from 'node:crypto'
import type { SessionRegistry, CreateSessionOpts } from './registry'
import type { CreateSessionVariantResult } from '../../shared/api-types'
import { getDb, prepared } from '../db/sqlite'
import type { Database } from 'bun:sqlite'

export interface CreateVariantsOpts extends Omit<CreateSessionOpts, 'slug'> {
  count: number
}

export interface CreateVariantsResult {
  variantGroupId: string
  sessions: CreateSessionVariantResult[]
}

export async function createSessionVariants(
  opts: CreateVariantsOpts,
  registry: SessionRegistry,
  dbProvider?: () => Database,
): Promise<CreateVariantsResult> {
  const resolveDb = dbProvider ?? getDb
  const variantGroupId = randomUUID()

  const tasks = Array.from({ length: opts.count }, () =>
    registry
      .create({ ...opts })
      .then(({ session }): CreateSessionVariantResult => {
        const db = resolveDb()
        prepared.updateSession(db, {
          id: session.id,
          variant_group_id: variantGroupId,
          updated_at: Date.now(),
        })
        return { sessionId: session.id, slug: session.slug, threadId: 0 }
      })
      .catch((err: unknown): CreateSessionVariantResult => ({
        error: err instanceof Error ? err.message : String(err),
      })),
  )

  const sessions = await Promise.all(tasks)
  return { variantGroupId, sessions }
}
