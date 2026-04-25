import { describe, test, expect, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { injectAgentFiles } from './inject-assets'

const TMPDIR = Bun.env['TMPDIR'] ?? '/tmp'
const tmpDirs: string[] = []

function trackedDir(): string {
  const dir = path.join(TMPDIR, `inject-assets-test-${crypto.randomBytes(6).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
})

function buildLegacyAssets(root: string): void {
  fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true })
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true })
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# CLAUDE')
  fs.writeFileSync(path.join(root, 'settings.json'), '{}')
  fs.writeFileSync(path.join(root, '.claude', 'agents', 'coding.md'), '# coding agent')
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'deploy.md'), '# deploy skill')
}

describe('injectAgentFiles', () => {
  test('copies entire asset tree recursively', () => {
    const assets = trackedDir()
    const cwd = trackedDir()
    fs.mkdirSync(path.join(assets, '.codex', 'hooks'), { recursive: true })
    fs.mkdirSync(path.join(assets, '.claude', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(assets, 'settings.json'), '{}')
    fs.writeFileSync(path.join(assets, '.codex', 'hooks', 'pre-commit.sh'), 'echo ok')
    fs.writeFileSync(path.join(assets, '.claude', 'agents', 'planner.md'), '# planner')

    injectAgentFiles(cwd, assets)

    expect(fs.existsSync(path.join(cwd, 'settings.json'))).toBe(true)
    expect(fs.existsSync(path.join(cwd, '.codex', 'hooks', 'pre-commit.sh'))).toBe(true)
    expect(fs.existsSync(path.join(cwd, '.claude', 'agents', 'planner.md'))).toBe(true)
  })

  test('does not overwrite existing files (no-overwrite policy)', () => {
    const assets = trackedDir()
    const cwd = trackedDir()
    buildLegacyAssets(assets)
    fs.mkdirSync(path.join(cwd, '.claude', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), '# EXISTING')
    fs.writeFileSync(path.join(cwd, '.claude', 'agents', 'coding.md'), '# EXISTING AGENT')

    injectAgentFiles(cwd, assets)

    expect(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('# EXISTING')
    expect(fs.readFileSync(path.join(cwd, '.claude', 'agents', 'coding.md'), 'utf8')).toBe('# EXISTING AGENT')
  })

  test('AGENT.md fans out to AGENTS.md and CLAUDE.md', () => {
    const assets = trackedDir()
    const cwd = trackedDir()
    fs.writeFileSync(path.join(assets, 'AGENT.md'), '# canonical')

    injectAgentFiles(cwd, assets)

    expect(fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8')).toBe('# canonical')
    expect(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('# canonical')
  })

  test('mirrors AGENTS.md to CLAUDE.md when only AGENTS.md exists', () => {
    const assets = trackedDir()
    const cwd = trackedDir()
    fs.writeFileSync(path.join(assets, 'AGENTS.md'), '# shared')

    injectAgentFiles(cwd, assets)

    expect(fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8')).toBe('# shared')
    expect(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('# shared')
  })

  test('mirrors CLAUDE.md to AGENTS.md when only CLAUDE.md exists', () => {
    const assets = trackedDir()
    const cwd = trackedDir()
    fs.writeFileSync(path.join(assets, 'CLAUDE.md'), '# claude-only')

    injectAgentFiles(cwd, assets)

    expect(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('# claude-only')
    expect(fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8')).toBe('# claude-only')
  })

  test('prefers .agent-assets over legacy .claude-assets', () => {
    const workspaceRoot = trackedDir()
    const cwd = trackedDir()
    const shared = path.join(workspaceRoot, '.agent-assets')
    const legacy = path.join(workspaceRoot, '.claude-assets')
    fs.mkdirSync(shared, { recursive: true })
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(shared, 'CLAUDE.md'), '# shared')
    fs.writeFileSync(path.join(legacy, 'CLAUDE.md'), '# legacy')
    const prevWorkspaceRoot = process.env['WORKSPACE_ROOT']
    delete process.env['MINION_AGENT_ASSETS_DIR']
    process.env['WORKSPACE_ROOT'] = workspaceRoot

    try {
      injectAgentFiles(cwd)
    } finally {
      if (prevWorkspaceRoot === undefined) delete process.env['WORKSPACE_ROOT']
      else process.env['WORKSPACE_ROOT'] = prevWorkspaceRoot
    }

    expect(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('# shared')
  })

  test('falls back to legacy .claude-assets when shared dir is absent', () => {
    const workspaceRoot = trackedDir()
    const cwd = trackedDir()
    const legacy = path.join(workspaceRoot, '.claude-assets')
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'CLAUDE.md'), '# legacy')
    const prevWorkspaceRoot = process.env['WORKSPACE_ROOT']
    delete process.env['MINION_AGENT_ASSETS_DIR']
    process.env['WORKSPACE_ROOT'] = workspaceRoot

    try {
      injectAgentFiles(cwd)
    } finally {
      if (prevWorkspaceRoot === undefined) delete process.env['WORKSPACE_ROOT']
      else process.env['WORKSPACE_ROOT'] = prevWorkspaceRoot
    }

    expect(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('# legacy')
  })

  test('uses MINION_AGENT_ASSETS_DIR override when set', () => {
    const workspaceRoot = trackedDir()
    const explicitRoot = trackedDir()
    const cwd = trackedDir()
    fs.writeFileSync(path.join(explicitRoot, 'CLAUDE.md'), '# explicit')
    fs.mkdirSync(path.join(workspaceRoot, '.agent-assets'), { recursive: true })
    fs.writeFileSync(path.join(workspaceRoot, '.agent-assets', 'CLAUDE.md'), '# shared')
    const prevWorkspaceRoot = process.env['WORKSPACE_ROOT']
    const prevOverride = process.env['MINION_AGENT_ASSETS_DIR']
    process.env['WORKSPACE_ROOT'] = workspaceRoot
    process.env['MINION_AGENT_ASSETS_DIR'] = explicitRoot

    try {
      injectAgentFiles(cwd)
    } finally {
      if (prevWorkspaceRoot === undefined) delete process.env['WORKSPACE_ROOT']
      else process.env['WORKSPACE_ROOT'] = prevWorkspaceRoot
      if (prevOverride === undefined) delete process.env['MINION_AGENT_ASSETS_DIR']
      else process.env['MINION_AGENT_ASSETS_DIR'] = prevOverride
    }

    expect(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('# explicit')
  })

  test('is a no-op when resolved assets root does not exist', () => {
    const cwd = trackedDir()
    const nonExistent = path.join(TMPDIR, 'no-such-assets-dir')
    const prevOverride = process.env['MINION_AGENT_ASSETS_DIR']
    process.env['MINION_AGENT_ASSETS_DIR'] = nonExistent

    try {
      expect(() => injectAgentFiles(cwd)).not.toThrow()
    } finally {
      if (prevOverride === undefined) delete process.env['MINION_AGENT_ASSETS_DIR']
      else process.env['MINION_AGENT_ASSETS_DIR'] = prevOverride
    }

    expect(fs.readdirSync(cwd)).toHaveLength(0)
  })
})
