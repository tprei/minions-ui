import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/preact'
import {
  StatusBadge,
  AttentionBadge,
  AttentionIconStack,
  getStatusColors,
  getAttentionBorder,
  formatRelativeTime,
  STATUS_CONFIG,
  ATTENTION_CONFIG,
} from '../../src/components/shared'
import type { ApiSession } from '../../src/api/types'

function makeSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 'session-1',
    slug: 'bold-meadow',
    status: 'running',
    command: '/task Add feature',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...overrides,
  }
}

describe('StatusBadge', () => {
  beforeEach(() => {
    cleanup()
  })

  it('renders running status', () => {
    render(<StatusBadge status="running" />)
    expect(screen.getByText('Running')).toBeTruthy()
  })

  it('renders pending status', () => {
    render(<StatusBadge status="pending" />)
    expect(screen.getByText('Idle')).toBeTruthy()
  })

  it('renders completed status', () => {
    render(<StatusBadge status="completed" />)
    expect(screen.getByText('Done')).toBeTruthy()
  })

  it('renders failed status', () => {
    render(<StatusBadge status="failed" />)
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('renders skipped status', () => {
    render(<StatusBadge status="skipped" />)
    expect(screen.getByText('Skipped')).toBeTruthy()
  })

  it('renders rebasing status', () => {
    render(<StatusBadge status="rebasing" />)
    expect(screen.getByText('Rebasing')).toBeTruthy()
  })

  it('renders rebase-conflict status', () => {
    render(<StatusBadge status="rebase-conflict" />)
    expect(screen.getByText('Rebase Conflict')).toBeTruthy()
  })

  it('renders emoji for each status', () => {
    for (const [status, config] of Object.entries(STATUS_CONFIG)) {
      cleanup()
      render(<StatusBadge status={status as keyof typeof STATUS_CONFIG} />)
      expect(screen.getByText(config.emoji)).toBeTruthy()
      expect(screen.getByText(config.label)).toBeTruthy()
    }
  })
})

describe('AttentionBadge', () => {
  beforeEach(() => {
    cleanup()
  })

  it('renders failed attention reason', () => {
    render(<AttentionBadge reason="failed" darkMode={false} />)
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('renders waiting_for_feedback attention reason', () => {
    render(<AttentionBadge reason="waiting_for_feedback" darkMode={false} />)
    expect(screen.getByText('Waiting for reply')).toBeTruthy()
  })

  it('renders interrupted attention reason', () => {
    render(<AttentionBadge reason="interrupted" darkMode={false} />)
    expect(screen.getByText('Interrupted')).toBeTruthy()
  })

  it('renders ci_fix attention reason', () => {
    render(<AttentionBadge reason="ci_fix" darkMode={false} />)
    expect(screen.getByText('CI fix in progress')).toBeTruthy()
  })

  it('renders idle_long attention reason', () => {
    render(<AttentionBadge reason="idle_long" darkMode={false} />)
    expect(screen.getByText('Idle for a while')).toBeTruthy()
  })

  it('renders emoji for each attention reason', () => {
    for (const [reason, config] of Object.entries(ATTENTION_CONFIG)) {
      cleanup()
      render(<AttentionBadge reason={reason as keyof typeof ATTENTION_CONFIG} darkMode={false} />)
      expect(screen.getByText(config.emoji)).toBeTruthy()
    }
  })
})

describe('AttentionIconStack', () => {
  beforeEach(() => {
    cleanup()
  })

  it('renders nothing when reasons is empty', () => {
    const { container } = render(<AttentionIconStack reasons={[]} darkMode={false} />)
    expect(container.querySelector('[data-testid="attention-icon-stack"]')).toBeNull()
  })

  it('renders a single icon for a single reason', () => {
    render(<AttentionIconStack reasons={['failed']} darkMode={false} />)
    const stack = document.querySelector('[data-testid="attention-icon-stack"]')
    expect(stack).toBeTruthy()
    const icons = stack!.querySelectorAll('[data-attention-reason]')
    expect(icons).toHaveLength(1)
    expect(icons[0].getAttribute('data-attention-reason')).toBe('failed')
  })

  it('renders all reasons as separate icons in order', () => {
    render(
      <AttentionIconStack
        reasons={['failed', 'waiting_for_feedback', 'ci_fix']}
        darkMode={false}
      />
    )
    const icons = document.querySelectorAll('[data-attention-reason]')
    expect(icons).toHaveLength(3)
    expect(icons[0].getAttribute('data-attention-reason')).toBe('failed')
    expect(icons[1].getAttribute('data-attention-reason')).toBe('waiting_for_feedback')
    expect(icons[2].getAttribute('data-attention-reason')).toBe('ci_fix')
  })

  it('sets title attribute to the full reason label for accessibility', () => {
    render(<AttentionIconStack reasons={['waiting_for_feedback']} darkMode={false} />)
    const icon = document.querySelector('[data-attention-reason="waiting_for_feedback"]')
    expect(icon?.getAttribute('title')).toBe('Waiting for reply')
    expect(icon?.getAttribute('aria-label')).toBe('Waiting for reply')
  })

  it('uses dark-mode classes when darkMode is true', () => {
    render(<AttentionIconStack reasons={['failed']} darkMode={true} />)
    const icon = document.querySelector('[data-attention-reason="failed"]')!
    expect(icon.className).toContain('bg-red-900/50')
  })
})

describe('getStatusColors', () => {
  it('returns light mode colors', () => {
    const colors = getStatusColors(false)
    expect(colors.pending.bg).toBe('#f3f4f6')
    expect(colors.running.border).toBe('#3b82f6')
    expect(colors.completed.text).toBe('#166534')
    expect(colors.failed.bg).toBe('#fee2e2')
    expect(colors.skipped.border).toBe('#a8a29e')
  })

  it('returns dark mode colors', () => {
    const colors = getStatusColors(true)
    expect(colors.pending.bg).toBe('#374151')
    expect(colors.running.border).toBe('#3b82f6')
    expect(colors.completed.text).toBe('#86efac')
    expect(colors.failed.bg).toBe('#7f1d1d')
    expect(colors.skipped.border).toBe('#78716c')
  })

  it('covers all statuses', () => {
    const colors = getStatusColors(false)
    expect(Object.keys(colors)).toEqual(['pending', 'running', 'completed', 'failed', 'skipped', 'ci-pending', 'ci-failed', 'landed', 'rebasing', 'rebase-conflict', 'cancelled'])
  })

  it('each status has bg, border, and text', () => {
    for (const isDark of [true, false]) {
      const colors = getStatusColors(isDark)
      for (const status of Object.values(colors)) {
        expect(status).toHaveProperty('bg')
        expect(status).toHaveProperty('border')
        expect(status).toHaveProperty('text')
      }
    }
  })
})

describe('getAttentionBorder', () => {
  it('returns empty string when not needing attention', () => {
    const session = makeSession({ needsAttention: false })
    expect(getAttentionBorder(session, false)).toBe('')
  })

  it('returns red ring for failed attention', () => {
    const session = makeSession({ needsAttention: true, attentionReasons: ['failed'] })
    expect(getAttentionBorder(session, false)).toBe('ring-2 ring-red-400/60')
    expect(getAttentionBorder(session, true)).toBe('ring-2 ring-red-500/60')
  })

  it('returns yellow ring for waiting_for_feedback attention', () => {
    const session = makeSession({ needsAttention: true, attentionReasons: ['waiting_for_feedback'] })
    expect(getAttentionBorder(session, false)).toBe('ring-2 ring-yellow-400/60')
    expect(getAttentionBorder(session, true)).toBe('ring-2 ring-yellow-500/60')
  })

  it('returns orange ring for interrupted attention', () => {
    const session = makeSession({ needsAttention: true, attentionReasons: ['interrupted'] })
    expect(getAttentionBorder(session, false)).toBe('ring-2 ring-orange-400/60')
    expect(getAttentionBorder(session, true)).toBe('ring-2 ring-orange-500/60')
  })

  it('returns empty string for ci_fix and idle_long attention', () => {
    const session = makeSession({ needsAttention: true, attentionReasons: ['ci_fix'] })
    expect(getAttentionBorder(session, false)).toBe('')
  })

  it('prioritizes failed over waiting_for_feedback', () => {
    const session = makeSession({ needsAttention: true, attentionReasons: ['waiting_for_feedback', 'failed'] })
    expect(getAttentionBorder(session, false)).toBe('ring-2 ring-red-400/60')
  })
})

describe('formatRelativeTime', () => {
  it('returns "just now" for recent timestamps', () => {
    const now = new Date().toISOString()
    expect(formatRelativeTime(now)).toBe('just now')
  })

  it('returns minutes ago for timestamps within the hour', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString()
    expect(formatRelativeTime(fiveMinutesAgo)).toBe('5m ago')
  })

  it('returns hours ago for timestamps within the day', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString()
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago')
  })

  it('returns days ago for timestamps within the week', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString()
    expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago')
  })

  it('returns locale date string for timestamps older than a week', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000)
    const result = formatRelativeTime(twoWeeksAgo.toISOString())
    expect(result).toBe(twoWeeksAgo.toLocaleDateString())
  })
})
