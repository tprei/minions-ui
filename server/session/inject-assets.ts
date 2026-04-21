import fs from 'node:fs'
import path from 'node:path'

const ASSET_FILES = ['CLAUDE.md', 'settings.json'] as const
const AGENT_DIRS = ['.claude/agents', '.claude/skills'] as const

function copyIfAbsent(src: string, dest: string): void {
  if (fs.existsSync(dest)) return
  const destDir = path.dirname(dest)
  fs.mkdirSync(destDir, { recursive: true })
  fs.copyFileSync(src, dest)
}

function copyDirContentsIfAbsent(srcDir: string, destDir: string): void {
  if (!fs.existsSync(srcDir)) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const src = path.join(srcDir, entry.name)
    const dest = path.join(destDir, entry.name)
    copyIfAbsent(src, dest)
  }
}

export function injectAgentFiles(cwd: string, assetsRoot?: string): void {
  const src = assetsRoot ?? path.join(process.env['WORKSPACE_ROOT'] ?? './.minion-data', '.claude-assets')

  if (!fs.existsSync(src)) return

  for (const file of ASSET_FILES) {
    const srcPath = path.join(src, file)
    if (!fs.existsSync(srcPath)) continue
    copyIfAbsent(srcPath, path.join(cwd, file))
  }

  for (const dir of AGENT_DIRS) {
    copyDirContentsIfAbsent(path.join(src, dir), path.join(cwd, dir))
  }
}
