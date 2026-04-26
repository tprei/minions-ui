import type { ConnectionStore } from '../state/types'
import type { VersionInfo } from './types'

export type FeatureName =
  | 'messages'
  | 'sessions-create'
  | 'sessions-create-images'
  | 'sessions-variants'
  | 'pr-preview'
  | 'diff'
  | 'screenshots'
  | 'web-push'
  | 'worktree-stats'
  | 'transcript'
  | 'resource-metrics'
  | 'runtime-config'
  | 'merge-readiness'
  | 'ship-coordinator'
  | 'memory'

export function hasFeature(
  source: ConnectionStore | VersionInfo | null | undefined,
  name: FeatureName,
): boolean {
  if (!source) return false
  const version: VersionInfo | null =
    'features' in source && Array.isArray((source as VersionInfo).features)
      ? (source as VersionInfo)
      : (source as ConnectionStore).version.value
  if (!version) return false
  return version.features.includes(name)
}
