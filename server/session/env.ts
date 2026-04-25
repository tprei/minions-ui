import fs from 'node:fs'
import path from 'node:path'

export function buildIsolatedEnv({
  workspaceHome,
}: {
  workspaceHome: string
}): NodeJS.ProcessEnv {
  for (const subdir of [
    '.claude',
    'tmp',
    '.config',
    '.cache',
    '.local/share',
    '.local/state',
    'screenshots',
  ]) {
    fs.mkdirSync(path.join(workspaceHome, subdir), { recursive: true })
  }

  const env: NodeJS.ProcessEnv = { ...process.env }

  env['HOME'] = workspaceHome
  env['TMPDIR'] = path.join(workspaceHome, 'tmp')
  env['XDG_CONFIG_HOME'] = path.join(workspaceHome, '.config')
  env['XDG_CACHE_HOME'] = path.join(workspaceHome, '.cache')
  env['XDG_DATA_HOME'] = path.join(workspaceHome, '.local', 'share')
  env['XDG_STATE_HOME'] = path.join(workspaceHome, '.local', 'state')
  env['PLAYWRIGHT_BROWSERS_PATH'] = process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? '/opt/pw-browsers'

  for (const key of ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'SUPABASE_ACCESS_TOKEN'] as const) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key]
    } else {
      delete env[key]
    }
  }

  return env
}
