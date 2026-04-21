import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}

export async function applyLocalDefaults(): Promise<void> {
  if (!process.env['PORT']) {
    process.env['PORT'] = '8080'
  }

  if (!process.env['CORS_ALLOWED_ORIGINS']) {
    process.env['CORS_ALLOWED_ORIGINS'] = 'http://localhost:5173'
  }

  if (!process.env['MINION_API_TOKEN']) {
    const root = process.env['WORKSPACE_ROOT'] ?? process.cwd()
    const tokenFile = join(root, '.api-token')

    if (existsSync(tokenFile)) {
      const stored = readFileSync(tokenFile, 'utf8').trim()
      if (stored.length >= 32) {
        process.env['MINION_API_TOKEN'] = stored
      }
    }

    if (!process.env['MINION_API_TOKEN']) {
      const token = randomBytes(16).toString('hex')
      writeFileSync(tokenFile, token, { mode: 0o600 })
      process.env['MINION_API_TOKEN'] = token
    }
  }

  if (!process.env['GITHUB_TOKEN']) {
    const ghToken = await execFileAsync('gh', ['auth', 'token']).catch(() => null)
    if (ghToken !== null && ghToken.length > 0) {
      process.env['GITHUB_TOKEN'] = ghToken
    }
  }
}
