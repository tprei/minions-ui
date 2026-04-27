import { describe, test, expect } from 'bun:test'
import { sessionRowToApi } from './wire-mappers'
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

describe('sessionRowToApi', () => {
  describe('metadata field', () => {
    test('excludes metadata when empty object', () => {
      const row = makeRow({ metadata: {} })
      const api = sessionRowToApi(row)
      expect(api.metadata).toBeUndefined()
    })

    test('includes metadata when non-empty', () => {
      const row = makeRow({ metadata: { kind: 'feedback', vote: 'up' } })
      const api = sessionRowToApi(row)
      expect(api.metadata).toEqual({ kind: 'feedback', vote: 'up' })
    })

    test('includes metadata with feedback details', () => {
      const row = makeRow({
        metadata: {
          kind: 'feedback',
          vote: 'down',
          reason: 'incorrect',
          comment: 'wrong approach',
          sourceSessionId: 'sess-parent',
          sourceSessionSlug: 'parent-slug',
          sourceMessageBlockId: 'block-123',
        },
      })
      const api = sessionRowToApi(row)
      expect(api.metadata).toEqual({
        kind: 'feedback',
        vote: 'down',
        reason: 'incorrect',
        comment: 'wrong approach',
        sourceSessionId: 'sess-parent',
        sourceSessionSlug: 'parent-slug',
        sourceMessageBlockId: 'block-123',
      })
    })

    test('preserves metadata structure for other kinds', () => {
      const row = makeRow({ metadata: { customKey: 'customValue', nested: { deep: true } } })
      const api = sessionRowToApi(row)
      expect(api.metadata).toEqual({ customKey: 'customValue', nested: { deep: true } })
    })
  })
})
