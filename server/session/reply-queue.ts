import fs from 'node:fs'
import path from 'node:path'

export interface QueuedReply {
  seq: number
  text: string
  images?: Array<{ mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; dataBase64: string }>
  enqueuedAt: number
}

let bootSeq = 0

function nextSeq(): number {
  return ++bootSeq
}

function atomicWrite(filePath: string, data: string): void {
  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.writeFileSync(tmp, data, 'utf8')
  fs.renameSync(tmp, filePath)
}

export class ReplyQueue {
  private readonly queueDir: string

  constructor(cwd: string) {
    this.queueDir = path.join(cwd, '.minion', 'reply-queue')
    fs.mkdirSync(this.queueDir, { recursive: true })
  }

  push(text: string, images?: QueuedReply['images']): QueuedReply {
    const seq = nextSeq()
    const entry: QueuedReply = { seq, text, enqueuedAt: Date.now(), ...(images && images.length > 0 ? { images } : {}) }
    const filePath = path.join(this.queueDir, `${seq}.json`)
    atomicWrite(filePath, JSON.stringify(entry))
    return entry
  }

  pending(): QueuedReply[] {
    const delivered = this.loadDelivered()
    const entries: QueuedReply[] = []

    let names: string[]
    try {
      names = fs.readdirSync(this.queueDir)
    } catch {
      return []
    }

    for (const name of names) {
      if (!/^\d+\.json$/.test(name)) continue
      const seq = parseInt(name.slice(0, -5), 10)
      if (delivered.has(seq)) continue
      const filePath = path.join(this.queueDir, name)
      try {
        const raw = fs.readFileSync(filePath, 'utf8')
        const entry = JSON.parse(raw) as QueuedReply
        if (typeof entry.seq !== 'number' || typeof entry.text !== 'string' || typeof entry.enqueuedAt !== 'number') continue
        entries.push(entry)
      } catch {
        // torn write — skip
      }
    }

    entries.sort((a, b) => a.seq - b.seq)
    return entries
  }

  markDelivered(seq: number): void {
    const delivered = this.loadDelivered()
    delivered.add(seq)
    atomicWrite(this.deliveredPath(), JSON.stringify([...delivered]))
  }

  clear(): void {
    let names: string[]
    try {
      names = fs.readdirSync(this.queueDir)
    } catch {
      return
    }
    for (const name of names) {
      if (!/^\d+\.json$/.test(name)) continue
      try { fs.unlinkSync(path.join(this.queueDir, name)) } catch { /* already gone */ }
    }
    try { fs.unlinkSync(this.deliveredPath()) } catch { /* already gone */ }
  }

  clearDelivered(): void {
    const delivered = this.loadDelivered()
    for (const seq of delivered) {
      try { fs.unlinkSync(path.join(this.queueDir, `${seq}.json`)) } catch { /* already gone */ }
    }
    try { fs.unlinkSync(this.deliveredPath()) } catch { /* already gone */ }
  }

  private deliveredPath(): string {
    return path.join(this.queueDir, 'delivered.json')
  }

  private loadDelivered(): Set<number> {
    try {
      const raw = fs.readFileSync(this.deliveredPath(), 'utf8')
      const arr = JSON.parse(raw) as unknown
      if (!Array.isArray(arr)) return new Set()
      return new Set(arr.filter((v): v is number => typeof v === 'number'))
    } catch {
      return new Set()
    }
  }
}

export class ReplyQueueFactory {
  private readonly queues = new Map<string, ReplyQueue>()

  constructor(private readonly cwd: (sessionId: string) => string) {}

  get(sessionId: string): ReplyQueue {
    const existing = this.queues.get(sessionId)
    if (existing) return existing
    const q = new ReplyQueue(this.cwd(sessionId))
    this.queues.set(sessionId, q)
    return q
  }
}
