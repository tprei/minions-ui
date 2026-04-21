import fs from 'node:fs'
import path from 'node:path'
import webpush from 'web-push'

export interface VapidKeys {
  publicKey: string
  privateKey: string
  subject: string
}

let cached: VapidKeys | null = null

export function ensureVapidKeys(): VapidKeys {
  if (cached) return cached

  const workspaceRoot = process.env['WORKSPACE_ROOT'] ?? './.minion-data'
  const vapidPath = path.join(workspaceRoot, '.vapid.json')

  if (fs.existsSync(vapidPath)) {
    const raw = JSON.parse(fs.readFileSync(vapidPath, 'utf8')) as Record<string, unknown>
    if (
      typeof raw['publicKey'] === 'string' &&
      typeof raw['privateKey'] === 'string' &&
      typeof raw['subject'] === 'string'
    ) {
      cached = { publicKey: raw['publicKey'], privateKey: raw['privateKey'], subject: raw['subject'] }
      return cached
    }
  }

  const { publicKey, privateKey } = webpush.generateVAPIDKeys()
  const subject = process.env['VAPID_SUBJECT'] ?? 'mailto:admin@localhost'
  const keys: VapidKeys = { publicKey, privateKey, subject }

  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.writeFileSync(vapidPath, JSON.stringify(keys, null, 2), 'utf8')
  cached = keys
  return cached
}

export function resetVapidCache(): void {
  cached = null
}
