import { describe, it, expect } from 'vitest'
import type { ApiSession } from '../../src/api/types'
import { countRunning, firstRunningId, isActive } from '../../src/state/running'

function mkSession(id: string, status: ApiSession['status']): ApiSession {
  return {
    id,
    slug: id,
    status,
    command: '',
    createdAt: '2026-04-19T00:00:00Z',
    updatedAt: '2026-04-19T00:00:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
  }
}

describe('running helpers', () => {
  it('isActive treats running and pending as active', () => {
    expect(isActive('running')).toBe(true)
    expect(isActive('pending')).toBe(true)
    expect(isActive('completed')).toBe(false)
    expect(isActive('failed')).toBe(false)
  })

  it('countRunning counts running + pending', () => {
    const sessions = [
      mkSession('a', 'running'),
      mkSession('b', 'completed'),
      mkSession('c', 'pending'),
      mkSession('d', 'failed'),
      mkSession('e', 'running'),
    ]
    expect(countRunning(sessions)).toBe(3)
  })

  it('countRunning returns 0 on empty input', () => {
    expect(countRunning([])).toBe(0)
  })

  it('firstRunningId returns id of first running or pending session', () => {
    const sessions = [
      mkSession('a', 'completed'),
      mkSession('b', 'pending'),
      mkSession('c', 'running'),
    ]
    expect(firstRunningId(sessions)).toBe('b')
  })

  it('firstRunningId returns null when nothing is active', () => {
    expect(firstRunningId([mkSession('a', 'completed')])).toBeNull()
    expect(firstRunningId([])).toBeNull()
  })
})
