import type { CreateSessionMode } from '../api/types'

export interface VariantGroup {
  groupId: string
  prompt: string
  mode: CreateSessionMode
  repo?: string
  variantSessionIds: string[]
  winnerId?: string
  createdAt: string
}

export interface VariantGroupsState {
  version: 1
  byConnection: Record<string, VariantGroup[]>
}
