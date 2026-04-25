import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { formatDoctorReport } from './doctor'
import type { DoctorReport } from './doctor'
import type { AgentProvider } from '../session/providers/types'

function makeTmpDir(): string {
  const dir = join(tmpdir(), `doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('formatDoctorReport', () => {
  test('formats ok check', () => {
    const report: DoctorReport = {
      checks: [{ name: 'Node ≥22', status: 'ok', detail: 'v22.0.0' }],
    }
    const output = formatDoctorReport(report)
    expect(output).toContain('[ok]')
    expect(output).toContain('Node ≥22')
    expect(output).toContain('v22.0.0')
  })

  test('formats warn check', () => {
    const report: DoctorReport = {
      checks: [{ name: 'GITHUB_TOKEN', status: 'warn', detail: 'not set' }],
    }
    const output = formatDoctorReport(report)
    expect(output).toContain('[warn]')
    expect(output).toContain('GITHUB_TOKEN')
  })

  test('formats fail check', () => {
    const report: DoctorReport = {
      checks: [{ name: 'claude CLI', status: 'fail', detail: 'not found' }],
    }
    const output = formatDoctorReport(report)
    expect(output).toContain('[fail]')
    expect(output).toContain('claude CLI')
  })

  test('formats check without detail', () => {
    const report: DoctorReport = {
      checks: [{ name: 'Port 8080 free', status: 'ok' }],
    }
    const output = formatDoctorReport(report)
    expect(output).toContain('[ok]')
    expect(output).toContain('Port 8080 free')
    expect(output).not.toContain('—')
  })

  test('formats multiple checks as separate lines', () => {
    const report: DoctorReport = {
      checks: [
        { name: 'Node ≥22', status: 'ok' },
        { name: 'GITHUB_TOKEN', status: 'warn' },
        { name: 'claude CLI', status: 'fail' },
      ],
    }
    const lines = formatDoctorReport(report).split('\n')
    expect(lines).toHaveLength(3)
  })
})

describe('runDoctor', () => {
  let tmpDir: string
  let origRoot: string | undefined
  let origToken: string | undefined
  let origPort: string | undefined

  beforeEach(() => {
    tmpDir = makeTmpDir()
    origRoot = process.env['WORKSPACE_ROOT']
    origToken = process.env['MINION_API_TOKEN']
    origPort = process.env['PORT']
    process.env['WORKSPACE_ROOT'] = tmpDir
    process.env['MINION_API_TOKEN'] = 'a'.repeat(32)
    process.env['PORT'] = '18999'
  })

  afterEach(() => {
    if (origRoot === undefined) delete process.env['WORKSPACE_ROOT']
    else process.env['WORKSPACE_ROOT'] = origRoot
    if (origToken === undefined) delete process.env['MINION_API_TOKEN']
    else process.env['MINION_API_TOKEN'] = origToken
    if (origPort === undefined) delete process.env['PORT']
    else process.env['PORT'] = origPort
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('returns a DoctorReport with all expected check names (claude provider)', async () => {
    const { runDoctor } = await import('./doctor')
    const report = await runDoctor({ name: 'claude' } as AgentProvider)
    const names = report.checks.map((c) => c.name)
    expect(names.some((n) => n.includes('Node'))).toBe(true)
    expect(names.some((n) => n.includes('WORKSPACE_ROOT'))).toBe(true)
    expect(names.some((n) => n.includes('Port'))).toBe(true)
    expect(names.some((n) => n.includes('MINION_API_TOKEN'))).toBe(true)
    expect(names.some((n) => n.includes('GITHUB_TOKEN'))).toBe(true)
    expect(names.some((n) => n.includes('claude'))).toBe(true)
  })

  test('codex provider includes codex CLI and auth checks instead of claude', async () => {
    const { runDoctor } = await import('./doctor')
    const report = await runDoctor({ name: 'codex' } as AgentProvider)
    const names = report.checks.map((c) => c.name)
    expect(names.some((n) => n.includes('codex'))).toBe(true)
    expect(names.every((n) => !n.includes('claude'))).toBe(true)
  })

  test('codex provider includes both binary and auth checks', async () => {
    const { runDoctor } = await import('./doctor')
    const report = await runDoctor({ name: 'codex' } as AgentProvider)
    const names = report.checks.map((c) => c.name)
    expect(names.some((n) => n === 'codex CLI')).toBe(true)
    expect(names.some((n) => n === 'codex auth')).toBe(true)
  })

  test('WORKSPACE_ROOT writable check passes for writable dir', async () => {
    const { runDoctor } = await import('./doctor')
    const report = await runDoctor()
    const check = report.checks.find((c) => c.name.includes('WORKSPACE_ROOT'))
    expect(check?.status).toBe('ok')
  })

  test('MINION_API_TOKEN check passes when token is ≥32 chars', async () => {
    const { runDoctor } = await import('./doctor')
    const report = await runDoctor()
    const check = report.checks.find((c) => c.name === 'MINION_API_TOKEN')
    expect(check?.status).toBe('ok')
  })

  test('MINION_API_TOKEN check fails when token is too short', async () => {
    process.env['MINION_API_TOKEN'] = 'short'
    const { runDoctor } = await import('./doctor')
    const report = await runDoctor()
    const check = report.checks.find((c) => c.name === 'MINION_API_TOKEN')
    expect(check?.status).toBe('fail')
  })

  test('MINION_API_TOKEN check warns when token not set', async () => {
    delete process.env['MINION_API_TOKEN']
    const { runDoctor } = await import('./doctor')
    const report = await runDoctor()
    const check = report.checks.find((c) => c.name === 'MINION_API_TOKEN')
    expect(check?.status).toBe('warn')
  })
})
