import fs from 'node:fs'
import path from 'node:path'

export function applyClaudeEnv(
  env: NodeJS.ProcessEnv,
  opts: { workspaceHome: string; parentHome: string },
): void {
  const { workspaceHome, parentHome } = opts

  const srcSettings = path.join(parentHome, '.claude', 'settings.json')
  const dstSettings = path.join(workspaceHome, '.claude', 'settings.json')
  if (fs.existsSync(srcSettings) && !fs.existsSync(dstSettings)) {
    fs.copyFileSync(srcSettings, dstSettings)
  }

  env['CLAUDE_CONFIG_DIR'] = path.join(parentHome, '.claude')
  env['CLAUDE_CODE_STREAM_CLOSE_TIMEOUT'] = '30000'
}
