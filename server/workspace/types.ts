export interface WorkspaceHandle {
  slug: string
  cwd: string
  bareDir: string
  branch: string
  baseRef: string
}

export interface PrepareOpts {
  slug: string
  repoUrl: string
  workspaceRoot: string
  startRef?: string
  cacheVersion?: string
  bootstrap?: boolean
}
