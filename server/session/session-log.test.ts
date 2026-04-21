import { describe, test, expect, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { writeSessionLog, type SessionLog } from './session-log'

const TMPDIR = Bun.env['TMPDIR'] ?? '/tmp'
const tmpDirs: string[] = []

function trackedDir(): string {
  const dir = path.join(TMPDIR, `session-log-test-${crypto.randomBytes(6).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
})

describe('writeSessionLog', () => {
  test('writes session-log.json with correct shape', () => {
    const cwd = trackedDir()
    const meta = {
      sessionId: 'test-session-id',
      slug: 'cool-oak-1234',
      mode: 'task',
      repo: 'https://github.com/example/repo',
      branch: 'minion/cool-oak-1234',
      startedAt: Date.now() - 5000,
    }

    writeSessionLog(cwd, meta, 'completed', 5000)

    const logPath = path.join(cwd, 'session-log.json')
    expect(fs.existsSync(logPath)).toBe(true)

    const log = JSON.parse(fs.readFileSync(logPath, 'utf8')) as SessionLog
    expect(log.sessionId).toBe(meta.sessionId)
    expect(log.slug).toBe(meta.slug)
    expect(log.mode).toBe(meta.mode)
    expect(log.state).toBe('completed')
    expect(log.startedAt).toBe(meta.startedAt)
    expect(log.durationMs).toBe(5000)
    expect(log.endedAt).toBeGreaterThanOrEqual(meta.startedAt)
    expect(log.repo).toBe(meta.repo)
    expect(log.branch).toBe(meta.branch)
  })

  test('includes qualityReport when provided', () => {
    const cwd = trackedDir()
    const qualityReport = {
      allPassed: false,
      results: [{ name: 'lint', passed: false, output: 'error: unused import' }],
    }

    writeSessionLog(cwd, { sessionId: 's1', slug: 'sl', mode: 'task', startedAt: Date.now() }, 'errored', 1000, qualityReport)

    const log = JSON.parse(fs.readFileSync(path.join(cwd, 'session-log.json'), 'utf8')) as SessionLog
    expect(log.qualityReport).toEqual(qualityReport)
    expect(log.state).toBe('errored')
  })

  test('includes errorMessage when provided', () => {
    const cwd = trackedDir()
    writeSessionLog(
      cwd,
      { sessionId: 's2', slug: 'sl2', mode: 'task', startedAt: Date.now() },
      'quota_exhausted',
      2000,
      undefined,
      'quota limit hit',
    )

    const log = JSON.parse(fs.readFileSync(path.join(cwd, 'session-log.json'), 'utf8')) as SessionLog
    expect(log.errorMessage).toBe('quota limit hit')
    expect(log.state).toBe('quota_exhausted')
  })

  test('optional fields absent when not provided', () => {
    const cwd = trackedDir()
    writeSessionLog(cwd, { sessionId: 's3', slug: 'sl3', mode: 'task', startedAt: Date.now() }, 'completed', 100)

    const log = JSON.parse(fs.readFileSync(path.join(cwd, 'session-log.json'), 'utf8')) as SessionLog
    expect('qualityReport' in log).toBe(false)
    expect('errorMessage' in log).toBe(false)
    expect('prUrl' in log).toBe(false)
  })
})
