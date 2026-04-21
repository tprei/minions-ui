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

function buildAssets(root: string): void {
  fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true })
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true })
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# CLAUDE')
  fs.writeFileSync(path.join(root, 'settings.json'), '{}')
  fs.writeFileSync(path.join(root, '.claude', 'agents', 'coding.md'), '# coding agent')
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'deploy.md'), '# deploy skill')
}

describe('injectAgentFiles', () => {
  test('copies CLAUDE.md and settings.json to cwd', () => {
    const assets = trackedDir()
    const cwd = trackedDir()
    buildAssets(assets)

    injectAgentFiles(cwd, assets)

    expect(fs.existsSync(path.join(cwd, 'CLAUDE.md'))).toBe(true)
    expect(fs.existsSync(path.join(cwd, 'settings.json'))).toBe(true)
  })

  test('copies .claude/agents and .claude/skills contents', () => {
    const assets = trackedDir()
    const cwd = trackedDir()
    buildAssets(assets)

    injectAgentFiles(cwd, assets)

    expect(fs.existsSync(path.join(cwd, '.claude', 'agents', 'coding.md'))).toBe(true)
    expect(fs.existsSync(path.join(cwd, '.claude', 'skills', 'deploy.md'))).toBe(true)
  })

  test('does not overwrite existing files (no-overwrite policy)', () => {
    const assets = trackedDir()
    const cwd = trackedDir()
    buildAssets(assets)

    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), '# EXISTING')

    injectAgentFiles(cwd, assets)

    expect(fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('# EXISTING')
  })

  test('is a no-op when assets root does not exist', () => {
    const cwd = trackedDir()
    const nonExistent = path.join(TMPDIR, 'no-such-assets-dir')

    expect(() => injectAgentFiles(cwd, nonExistent)).not.toThrow()
    expect(fs.readdirSync(cwd)).toHaveLength(0)
  })

  test('skips non-existent optional assets gracefully', () => {
    const assets = trackedDir()
    const cwd = trackedDir()
    fs.writeFileSync(path.join(assets, 'CLAUDE.md'), '# only this')

    injectAgentFiles(cwd, assets)

    expect(fs.existsSync(path.join(cwd, 'CLAUDE.md'))).toBe(true)
    expect(fs.existsSync(path.join(cwd, 'settings.json'))).toBe(false)
  })
})
