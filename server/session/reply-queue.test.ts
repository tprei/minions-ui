import { describe, test, expect, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ReplyQueue } from './reply-queue'

const TMPDIR = Bun.env['TMPDIR'] ?? '/tmp'

function makeTmpDir(): string {
  const dir = path.join(TMPDIR, `reply-queue-test-${crypto.randomBytes(6).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const tmpDirs: string[] = []

function trackedDir(): string {
  const dir = makeTmpDir()
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
})

describe('ReplyQueue', () => {
  test('push returns entry with monotonically increasing seq', () => {
    const cwd = trackedDir()
    const q = new ReplyQueue(cwd)

    const a = q.push('hello')
    const b = q.push('world')

    expect(b.seq).toBeGreaterThan(a.seq)
    expect(a.text).toBe('hello')
    expect(b.text).toBe('world')
    expect(a.enqueuedAt).toBeGreaterThan(0)
  })

  test('pending returns un-delivered entries in seq order', () => {
    const cwd = trackedDir()
    const q = new ReplyQueue(cwd)

    const a = q.push('first')
    const b = q.push('second')
    const c = q.push('third')

    const entries = q.pending()
    expect(entries.map((e) => e.seq)).toEqual([a.seq, b.seq, c.seq])
  })

  test('markDelivered removes entry from pending', () => {
    const cwd = trackedDir()
    const q = new ReplyQueue(cwd)

    const a = q.push('alpha')
    const b = q.push('beta')

    q.markDelivered(a.seq)

    const pending = q.pending()
    expect(pending).toHaveLength(1)
    expect(pending[0]!.seq).toBe(b.seq)
  })

  test('pending survives re-instantiation (crash recovery)', () => {
    const cwd = trackedDir()
    const q1 = new ReplyQueue(cwd)
    const entry = q1.push('survive me')

    const q2 = new ReplyQueue(cwd)
    const pending = q2.pending()
    expect(pending).toHaveLength(1)
    expect(pending[0]!.text).toBe('survive me')
    expect(pending[0]!.seq).toBe(entry.seq)
  })

  test('markDelivered survives re-instantiation', () => {
    const cwd = trackedDir()
    const q1 = new ReplyQueue(cwd)
    const entry = q1.push('deliver me')
    q1.markDelivered(entry.seq)

    const q2 = new ReplyQueue(cwd)
    expect(q2.pending()).toHaveLength(0)
  })

  test('push stores images', () => {
    const cwd = trackedDir()
    const q = new ReplyQueue(cwd)
    const images = [{ mediaType: 'image/png' as const, dataBase64: 'abc123' }]
    const entry = q.push('with image', images)

    expect(entry.images).toEqual(images)
    const pending = q.pending()
    expect(pending[0]!.images).toEqual(images)
  })

  test('torn write (truncated file) is skipped in pending', () => {
    const cwd = trackedDir()
    const q = new ReplyQueue(cwd)
    const good = q.push('valid')

    const queueDir = path.join(cwd, '.minion', 'reply-queue')
    fs.writeFileSync(path.join(queueDir, '99999.json'), '{broken json')

    const pending = q.pending()
    expect(pending.some((e) => e.seq === good.seq)).toBe(true)
    expect(pending.some((e) => e.seq === 99999)).toBe(false)
  })

  test('clear removes all entries', () => {
    const cwd = trackedDir()
    const q = new ReplyQueue(cwd)
    q.push('a')
    q.push('b')
    q.clear()
    expect(q.pending()).toHaveLength(0)
  })

  test('clearDelivered removes only delivered entry files', () => {
    const cwd = trackedDir()
    const q = new ReplyQueue(cwd)
    const a = q.push('a')
    const b = q.push('b')
    q.markDelivered(a.seq)

    q.clearDelivered()

    const pending = q.pending()
    expect(pending).toHaveLength(1)
    expect(pending[0]!.seq).toBe(b.seq)
  })
})
