import { execFile as execFileCb } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { createServer } from 'node:net'

export interface DoctorCheck {
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail?: string
}

export interface DoctorReport {
  checks: DoctorCheck[]
}

function execAsync(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

function checkPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

async function checkNodeVersion(): Promise<DoctorCheck> {
  const version = process.version
  const major = parseInt(version.replace('v', '').split('.')[0] ?? '0', 10)
  if (major >= 22) {
    return { name: 'Node ≥22', status: 'ok', detail: version }
  }
  return { name: 'Node ≥22', status: 'fail', detail: `found ${version}` }
}

async function checkWorkspaceWritable(): Promise<DoctorCheck> {
  const root = process.env['WORKSPACE_ROOT'] ?? process.cwd()
  const writable = await access(root, constants.W_OK).then(() => true).catch(() => false)
  if (writable) {
    return { name: 'WORKSPACE_ROOT writable', status: 'ok', detail: root }
  }
  return { name: 'WORKSPACE_ROOT writable', status: 'fail', detail: `not writable: ${root}` }
}

async function checkPortFreeCheck(): Promise<DoctorCheck> {
  const port = Number(process.env['PORT'] ?? 8080)
  const free = await checkPortFree(port)
  if (free) {
    return { name: `Port ${port} free`, status: 'ok' }
  }
  return { name: `Port ${port} free`, status: 'fail', detail: `port ${port} is already in use` }
}

async function checkApiToken(): Promise<DoctorCheck> {
  const token = process.env['MINION_API_TOKEN'] ?? ''
  if (token.length >= 32) {
    return { name: 'MINION_API_TOKEN', status: 'ok', detail: `${token.length} chars` }
  }
  if (token.length === 0) {
    return { name: 'MINION_API_TOKEN', status: 'warn', detail: 'not set — engine will run unauthenticated' }
  }
  return { name: 'MINION_API_TOKEN', status: 'fail', detail: `too short (${token.length} chars, need ≥32)` }
}

async function checkGithubToken(): Promise<DoctorCheck> {
  if (process.env['GITHUB_TOKEN']) {
    return { name: 'GITHUB_TOKEN', status: 'ok', detail: 'set via env' }
  }
  const ghResult = await execAsync('gh', ['auth', 'token'], 5000).catch(() => null)
  if (ghResult !== null && ghResult.stdout.length > 0) {
    return { name: 'GITHUB_TOKEN', status: 'ok', detail: 'gh auth token available' }
  }
  return { name: 'GITHUB_TOKEN', status: 'warn', detail: 'not set and gh auth token failed' }
}

async function checkClaudeAuth(): Promise<DoctorCheck> {
  const result = await execAsync('claude', ['--version'], 5000).catch(() => null)
  if (result !== null) {
    return { name: 'claude CLI', status: 'ok', detail: result.stdout.split('\n')[0] ?? result.stdout }
  }
  return { name: 'claude CLI', status: 'fail', detail: 'claude --version failed — is claude CLI installed and on PATH?' }
}

export async function runDoctor(): Promise<DoctorReport> {
  const checks = await Promise.all([
    checkNodeVersion(),
    checkWorkspaceWritable(),
    checkPortFreeCheck(),
    checkApiToken(),
    checkGithubToken(),
    checkClaudeAuth(),
  ])

  return { checks }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = []
  for (const check of report.checks) {
    const badge = check.status === 'ok' ? '[ok]  ' : check.status === 'warn' ? '[warn]' : '[fail]'
    const detail = check.detail ? `  — ${check.detail}` : ''
    lines.push(`${badge}  ${check.name}${detail}`)
  }
  return lines.join('\n')
}
