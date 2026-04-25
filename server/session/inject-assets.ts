import fs from 'node:fs'
import path from 'node:path'

function copyIfAbsent(src: string, dest: string): void {
  if (fs.existsSync(dest)) return
  const destDir = path.dirname(dest)
  fs.mkdirSync(destDir, { recursive: true })
  fs.copyFileSync(src, dest)
}

function copyPathIfAbsent(src: string, dest: string): void {
  if (fs.existsSync(dest)) return
  let stat: fs.Stats
  try {
    stat = fs.statSync(src)
  } catch {
    return
  }

  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(src, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      copyPathIfAbsent(path.join(src, entry.name), path.join(dest, entry.name))
    }
    return
  }

  if (stat.isFile()) {
    copyIfAbsent(src, dest)
  }
}

function resolveAssetsRoot(assetsRoot?: string, workspaceRootOverride?: string): string | undefined {
  if (assetsRoot) return assetsRoot
  if (process.env['MINION_AGENT_ASSETS_DIR']) return process.env['MINION_AGENT_ASSETS_DIR']

  const workspaceRoot = workspaceRootOverride ?? process.env['WORKSPACE_ROOT'] ?? './.minion-data'
  const sharedPath = path.join(workspaceRoot, '.agent-assets')
  if (fs.existsSync(sharedPath)) return sharedPath

  const legacyPath = path.join(workspaceRoot, '.claude-assets')
  if (fs.existsSync(legacyPath)) return legacyPath

  return undefined
}

function mirrorInstructionFiles(cwd: string, src: string): void {
  const agent = path.join(src, 'AGENT.md')
  const agents = path.join(src, 'AGENTS.md')
  const claude = path.join(src, 'CLAUDE.md')

  if (fs.existsSync(agent)) {
    copyIfAbsent(agent, path.join(cwd, 'AGENTS.md'))
    copyIfAbsent(agent, path.join(cwd, 'CLAUDE.md'))
  }

  const hasAgents = fs.existsSync(agents)
  const hasClaude = fs.existsSync(claude)
  if (hasAgents && !hasClaude) copyIfAbsent(agents, path.join(cwd, 'CLAUDE.md'))
  if (hasClaude && !hasAgents) copyIfAbsent(claude, path.join(cwd, 'AGENTS.md'))
}

export function injectAgentFiles(cwd: string, assetsRoot?: string, workspaceRootOverride?: string): void {
  const src = resolveAssetsRoot(assetsRoot, workspaceRootOverride)
  if (!src || !fs.existsSync(src)) return

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(src, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    copyPathIfAbsent(path.join(src, entry.name), path.join(cwd, entry.name))
  }

  mirrorInstructionFiles(cwd, src)
}
