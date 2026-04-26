import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PrPreview, QualityReport } from '../../shared/api-types'
import { buildMergeReadiness } from './merge-readiness'

function tempWorkspace(): { root: string; slug: string; cwd: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-test-'))
  const slug = 'session-one'
  const cwd = path.join(root, slug)
  fs.mkdirSync(cwd)
  return { root, slug, cwd }
}

function pr(overrides: Partial<PrPreview> = {}): PrPreview {
  return {
    number: 1,
    url: 'https://github.com/org/repo/pull/1',
    title: 'PR',
    body: '',
    state: 'open',
    draft: false,
    mergeable: true,
    branch: 'feature',
    baseBranch: 'main',
    author: 'octocat',
    updatedAt: '2026-04-26T00:00:00Z',
    checks: [{ name: 'ci', status: 'success' }],
    ...overrides,
  }
}

function qualityReport(allPassed: boolean): QualityReport {
  return {
    allPassed,
    results: [
      {
        name: 'lint',
        command: ['npm', 'run', 'lint'],
        required: true,
        passed: allPassed,
        skipped: false,
        output: allPassed ? 'ok' : 'failed',
        durationMs: 1,
      },
    ],
  }
}

describe('buildMergeReadiness', () => {
  test('returns ready when policy checks pass', async () => {
    const ws = tempWorkspace()
    fs.writeFileSync(path.join(ws.cwd, 'minions.json'), JSON.stringify({ merge: { requireCiPass: true } }))
    const readiness = await buildMergeReadiness(
      {
        id: 's1',
        slug: ws.slug,
        status: 'completed',
        pr_url: 'https://github.com/org/repo/pull/1',
        workspace_root: ws.root,
        metadata: { qualityReport: qualityReport(true) },
      },
      async () => pr(),
    )
    expect(readiness.status).toBe('ready')
    fs.rmSync(ws.root, { recursive: true, force: true })
  })

  test('blocks when required quality gates failed', async () => {
    const ws = tempWorkspace()
    const readiness = await buildMergeReadiness(
      {
        id: 's1',
        slug: ws.slug,
        status: 'completed',
        pr_url: 'https://github.com/org/repo/pull/1',
        workspace_root: ws.root,
        metadata: { qualityReport: qualityReport(false) },
      },
      async () => pr(),
    )
    expect(readiness.status).toBe('blocked')
    expect(readiness.checks.find((check) => check.id === 'quality-gates')?.status).toBe('blocked')
    fs.rmSync(ws.root, { recursive: true, force: true })
  })

  test('blocks completed sessions without a required pull request', async () => {
    const ws = tempWorkspace()
    const readiness = await buildMergeReadiness({
      id: 's1',
      slug: ws.slug,
      status: 'completed',
      pr_url: null,
      workspace_root: ws.root,
      metadata: { qualityReport: qualityReport(true) },
    })
    expect(readiness.status).toBe('blocked')
    expect(readiness.checks.find((check) => check.id === 'pull-request')?.status).toBe('blocked')
    fs.rmSync(ws.root, { recursive: true, force: true })
  })
})
