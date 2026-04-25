import fs from 'node:fs'
import path from 'node:path'

export function applyCodexEnv(
  env: NodeJS.ProcessEnv,
  opts: { workspaceHome: string; parentHome: string },
): void {
  const { workspaceHome, parentHome } = opts
  fs.mkdirSync(path.join(workspaceHome, '.codex'), { recursive: true })
  env['CODEX_HOME'] = path.join(parentHome, '.codex')
}
