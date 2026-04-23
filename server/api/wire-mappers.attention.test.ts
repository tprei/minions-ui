import { describe, test, expect } from 'bun:test'
import { computeAttentionReasons, computeQuickActions } from './attention'
import type { SessionRow } from '../db/sqlite'

function makeRow(overrides: Partial<SessionRow> = {}): SessionRow {
  const now = Date.now()
  return {
    id: 'sess-1',
    slug: 'test-slug',
    status: 'running',
    command: 'do the thing',
    mode: 'task',
    repo: null,
    branch: null,
    bare_dir: null,
    pr_url: null,
    parent_id: null,
    variant_group_id: null,
    claude_session_id: null,
    workspace_root: null,
    created_at: now - 1000,
    updated_at: now - 1000,
    needs_attention: false,
    attention_reasons: [],
    quick_actions: [],
    conversation: [],
    quota_sleep_until: null,
    quota_retry_count: 0,
    metadata: {},
    pipeline_advancing: false,
    stage: null,
    coordinator_children: [],
    ...overrides,
  }
}

describe('computeAttentionReasons', () => {
  test('no reasons for healthy running session', () => {
    const row = makeRow({ updated_at: Date.now() - 1000 })
    const reasons = computeAttentionReasons(row, Date.now())
    expect(reasons).toEqual([])
  })

  test('failed status → failed reason', () => {
    const row = makeRow({ status: 'failed' })
    const reasons = computeAttentionReasons(row, Date.now())
    expect(reasons).toContain('failed')
  })

  test('waiting_input status → waiting_for_feedback', () => {
    const row = makeRow({ status: 'waiting_input' })
    const reasons = computeAttentionReasons(row, Date.now())
    expect(reasons).toContain('waiting_for_feedback')
  })

  test('running session idle > 30min → idle_long', () => {
    const LONG_AGO = Date.now() - 31 * 60 * 1000
    const row = makeRow({ status: 'running', updated_at: LONG_AGO })
    const reasons = computeAttentionReasons(row, Date.now())
    expect(reasons).toContain('idle_long')
  })

  test('recently updated running session → no idle_long', () => {
    const row = makeRow({ status: 'running', updated_at: Date.now() - 60_000 })
    const reasons = computeAttentionReasons(row, Date.now())
    expect(reasons).not.toContain('idle_long')
  })

  test('completed session idle > 30min → no idle_long (only running/waiting_input qualify)', () => {
    const LONG_AGO = Date.now() - 31 * 60 * 1000
    const row = makeRow({ status: 'completed', updated_at: LONG_AGO })
    const reasons = computeAttentionReasons(row, Date.now())
    expect(reasons).not.toContain('idle_long')
  })

  test('pendingFeedback in metadata → waiting_for_feedback', () => {
    const row = makeRow({ metadata: { pendingFeedback: ['feedback-1'] } })
    const reasons = computeAttentionReasons(row, Date.now())
    expect(reasons).toContain('waiting_for_feedback')
  })

  test('empty pendingFeedback array → no waiting_for_feedback from metadata', () => {
    const row = makeRow({ metadata: { pendingFeedback: [] } })
    const reasons = computeAttentionReasons(row, Date.now())
    expect(reasons).not.toContain('waiting_for_feedback')
  })

  test('deduplicates reasons across sources', () => {
    const row = makeRow({ status: 'waiting_input', metadata: { pendingFeedback: ['x'] } })
    const reasons = computeAttentionReasons(row, Date.now())
    const feedbackCount = reasons.filter((r) => r === 'waiting_for_feedback').length
    expect(feedbackCount).toBe(1)
  })

  test('failed + long idle → both reasons', () => {
    const LONG_AGO = Date.now() - 31 * 60 * 1000
    const row = makeRow({ status: 'failed', updated_at: LONG_AGO })
    const reasons = computeAttentionReasons(row, Date.now())
    expect(reasons).toContain('failed')
  })
})

describe('computeQuickActions', () => {
  test('running session gets retry/stop action', () => {
    const row = makeRow({ status: 'running' })
    const actions = computeQuickActions(row)
    expect(actions.length).toBeGreaterThan(0)
  })

  test('failed session gets retry and resume actions', () => {
    const row = makeRow({ status: 'failed' })
    const actions = computeQuickActions(row)
    const types = actions.map((a) => a.type)
    expect(types).toContain('retry')
    expect(types).toContain('resume')
  })

  test('completed session gets close action', () => {
    const row = makeRow({ status: 'completed' })
    const actions = computeQuickActions(row)
    const types = actions.map((a) => a.type)
    expect(types).toContain('make_pr')
  })

  test('pending session has no actions', () => {
    const row = makeRow({ status: 'pending' })
    const actions = computeQuickActions(row)
    expect(actions).toEqual([])
  })
})
