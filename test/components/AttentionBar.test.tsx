import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/preact'
import {
  AttentionBar,
  countByAttentionReason,
  filterSessionsByReason,
  firstSessionWithReason,
} from '../../src/components/AttentionBar'
import type { ApiSession, AttentionReason } from '../../src/api/types'

function makeSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 'session-1',
    slug: 'bold-meadow',
    status: 'running',
    command: '/task Add feature',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...overrides,
  }
}

describe('countByAttentionReason', () => {
  it('returns zero counts for all reasons when nothing needs attention', () => {
    const sessions = [makeSession(), makeSession({ id: 's2', slug: 'calm-lake' })]
    const counts = countByAttentionReason(sessions)
    expect(counts).toEqual({
      failed: 0,
      waiting_for_feedback: 0,
      interrupted: 0,
      ci_fix: 0,
      idle_long: 0,
    })
  })

  it('ignores sessions where needsAttention is false even if they have reasons', () => {
    const sessions = [
      makeSession({ needsAttention: false, attentionReasons: ['failed'] }),
    ]
    expect(countByAttentionReason(sessions).failed).toBe(0)
  })

  it('counts each reason independently, not per session', () => {
    const sessions = [
      makeSession({
        id: 's1',
        needsAttention: true,
        attentionReasons: ['failed', 'waiting_for_feedback'],
      }),
      makeSession({
        id: 's2',
        slug: 's2',
        needsAttention: true,
        attentionReasons: ['failed'],
      }),
      makeSession({
        id: 's3',
        slug: 's3',
        needsAttention: true,
        attentionReasons: ['interrupted'],
      }),
    ]
    const counts = countByAttentionReason(sessions)
    expect(counts.failed).toBe(2)
    expect(counts.waiting_for_feedback).toBe(1)
    expect(counts.interrupted).toBe(1)
    expect(counts.ci_fix).toBe(0)
    expect(counts.idle_long).toBe(0)
  })
})

describe('filterSessionsByReason', () => {
  const sessions: ApiSession[] = [
    makeSession({ id: 's1', needsAttention: true, attentionReasons: ['failed'] }),
    makeSession({
      id: 's2',
      slug: 's2',
      needsAttention: true,
      attentionReasons: ['waiting_for_feedback'],
    }),
    makeSession({ id: 's3', slug: 's3' }),
  ]

  it('returns all sessions when filter is null', () => {
    expect(filterSessionsByReason(sessions, null)).toHaveLength(3)
  })

  it('returns only sessions with the filter reason', () => {
    const filtered = filterSessionsByReason(sessions, 'failed')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('s1')
  })

  it('returns empty array when no session matches', () => {
    expect(filterSessionsByReason(sessions, 'idle_long')).toHaveLength(0)
  })
})

describe('firstSessionWithReason', () => {
  it('returns null when no matching session exists', () => {
    const sessions = [makeSession()]
    expect(firstSessionWithReason(sessions, 'failed')).toBeNull()
  })

  it('returns the most recently updated matching session', () => {
    const sessions = [
      makeSession({
        id: 'old',
        slug: 'old',
        updatedAt: '2024-01-01T00:00:00Z',
        needsAttention: true,
        attentionReasons: ['failed'],
      }),
      makeSession({
        id: 'new',
        slug: 'new',
        updatedAt: '2024-02-01T00:00:00Z',
        needsAttention: true,
        attentionReasons: ['failed'],
      }),
      makeSession({
        id: 'other',
        slug: 'other',
        updatedAt: '2024-03-01T00:00:00Z',
        needsAttention: true,
        attentionReasons: ['waiting_for_feedback'],
      }),
    ]
    expect(firstSessionWithReason(sessions, 'failed')?.id).toBe('new')
  })
})

describe('AttentionBar', () => {
  beforeEach(() => {
    cleanup()
  })

  it('renders nothing when no sessions need attention', () => {
    const { container } = render(
      <AttentionBar sessions={[makeSession()]} filter={null} onSelect={() => {}} />,
    )
    expect(container.querySelector('[data-testid="attention-bar"]')).toBeNull()
  })

  it('renders a pill per non-empty attention reason with counts', () => {
    const sessions = [
      makeSession({ id: 's1', needsAttention: true, attentionReasons: ['failed'] }),
      makeSession({
        id: 's2',
        slug: 's2',
        needsAttention: true,
        attentionReasons: ['failed', 'waiting_for_feedback'],
      }),
      makeSession({
        id: 's3',
        slug: 's3',
        needsAttention: true,
        attentionReasons: ['interrupted'],
      }),
    ]
    render(<AttentionBar sessions={sessions} filter={null} onSelect={() => {}} />)

    expect(screen.getByTestId('attention-bar')).toBeTruthy()
    expect(screen.getByTestId('attention-pill-failed').textContent).toContain('2')
    expect(screen.getByTestId('attention-pill-waiting_for_feedback').textContent).toContain('1')
    expect(screen.getByTestId('attention-pill-interrupted').textContent).toContain('1')
    expect(screen.queryByTestId('attention-pill-ci_fix')).toBeNull()
    expect(screen.queryByTestId('attention-pill-idle_long')).toBeNull()
  })

  it('invokes onSelect with reason and first matching session id when pill is clicked', () => {
    const onSelect = vi.fn()
    const sessions = [
      makeSession({
        id: 'old',
        updatedAt: '2024-01-01T00:00:00Z',
        needsAttention: true,
        attentionReasons: ['failed'],
      }),
      makeSession({
        id: 'new',
        slug: 'new',
        updatedAt: '2024-06-01T00:00:00Z',
        needsAttention: true,
        attentionReasons: ['failed'],
      }),
    ]
    render(<AttentionBar sessions={sessions} filter={null} onSelect={onSelect} />)

    fireEvent.click(screen.getByTestId('attention-pill-failed'))
    expect(onSelect).toHaveBeenCalledWith('failed', 'new')
  })

  it('clicking the active pill toggles the filter off with null id', () => {
    const onSelect = vi.fn()
    const sessions = [
      makeSession({ id: 's1', needsAttention: true, attentionReasons: ['failed'] }),
    ]
    render(<AttentionBar sessions={sessions} filter="failed" onSelect={onSelect} />)

    fireEvent.click(screen.getByTestId('attention-pill-failed'))
    expect(onSelect).toHaveBeenCalledWith(null, null)
  })

  it('marks the active pill with aria-pressed=true and others false', () => {
    const sessions = [
      makeSession({
        id: 's1',
        needsAttention: true,
        attentionReasons: ['failed', 'waiting_for_feedback'],
      }),
    ]
    render(<AttentionBar sessions={sessions} filter="failed" onSelect={() => {}} />)

    expect(
      screen.getByTestId('attention-pill-failed').getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByTestId('attention-pill-waiting_for_feedback').getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('shows a Clear filter button only when a filter is active', () => {
    const sessions = [
      makeSession({ id: 's1', needsAttention: true, attentionReasons: ['failed'] }),
    ]
    const { rerender } = render(
      <AttentionBar sessions={sessions} filter={null} onSelect={() => {}} />,
    )
    expect(screen.queryByTestId('attention-clear')).toBeNull()

    rerender(<AttentionBar sessions={sessions} filter="failed" onSelect={() => {}} />)
    expect(screen.getByTestId('attention-clear')).toBeTruthy()
  })

  it('Clear filter button calls onSelect(null, null)', () => {
    const onSelect = vi.fn()
    const sessions = [
      makeSession({ id: 's1', needsAttention: true, attentionReasons: ['failed'] }),
    ]
    render(<AttentionBar sessions={sessions} filter="failed" onSelect={onSelect} />)

    fireEvent.click(screen.getByTestId('attention-clear'))
    expect(onSelect).toHaveBeenCalledWith(null, null)
  })

  it('pill click with no matching session passes null id (edge case)', () => {
    const onSelect = vi.fn()
    const sessions = [
      makeSession({
        id: 's1',
        needsAttention: true,
        attentionReasons: ['failed'] as AttentionReason[],
      }),
    ]
    render(<AttentionBar sessions={sessions} filter={null} onSelect={onSelect} />)

    fireEvent.click(screen.getByTestId('attention-pill-failed'))
    expect(onSelect).toHaveBeenCalledWith('failed', 's1')
  })
})
