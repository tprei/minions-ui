import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { VariantGroup } from '../../src/groups/types'

function group(over: Partial<VariantGroup> = {}): VariantGroup {
  return {
    groupId: 'g1',
    prompt: 'do the thing',
    mode: 'task',
    variantSessionIds: ['s1', 's2'],
    createdAt: '2026-04-19T00:00:00Z',
    ...over,
  }
}

describe('variant groups store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('records a group for a connection and retrieves it', async () => {
    const m = await import('../../src/groups/store')
    m.recordVariantGroup('conn-a', group())
    expect(m.groupsForConnection('conn-a')).toHaveLength(1)
    expect(m.getVariantGroup('conn-a', 'g1')?.prompt).toBe('do the thing')
  })

  it('persists to localStorage on record', async () => {
    const m = await import('../../src/groups/store')
    m.recordVariantGroup('conn-a', group({ groupId: 'g-persist' }))
    const raw = localStorage.getItem('minions-ui:variant-groups:v1')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw ?? '{}') as { byConnection: Record<string, VariantGroup[]> }
    expect(parsed.byConnection['conn-a'][0].groupId).toBe('g-persist')
  })

  it('rehydrates from localStorage on fresh module load', async () => {
    localStorage.setItem(
      'minions-ui:variant-groups:v1',
      JSON.stringify({
        version: 1,
        byConnection: { 'conn-a': [group({ groupId: 'g-rehydrated' })] },
      })
    )
    const m = await import('../../src/groups/store')
    expect(m.getVariantGroup('conn-a', 'g-rehydrated')?.prompt).toBe('do the thing')
  })

  it('scopes groups by connection id', async () => {
    const m = await import('../../src/groups/store')
    m.recordVariantGroup('conn-a', group({ groupId: 'ga' }))
    m.recordVariantGroup('conn-b', group({ groupId: 'gb' }))
    expect(m.getVariantGroup('conn-a', 'gb')).toBeNull()
    expect(m.getVariantGroup('conn-b', 'ga')).toBeNull()
    expect(m.getVariantGroup('conn-b', 'gb')?.groupId).toBe('gb')
  })

  it('updates an existing group when recording the same id twice', async () => {
    const m = await import('../../src/groups/store')
    m.recordVariantGroup('conn-a', group({ prompt: 'first' }))
    m.recordVariantGroup('conn-a', group({ prompt: 'second' }))
    const list = m.groupsForConnection('conn-a')
    expect(list).toHaveLength(1)
    expect(list[0].prompt).toBe('second')
  })

  it('setVariantWinner marks the winner and refuses unknown ids', async () => {
    const m = await import('../../src/groups/store')
    m.recordVariantGroup('conn-a', group({ variantSessionIds: ['s1', 's2', 's3'] }))
    m.setVariantWinner('conn-a', 'g1', 'not-a-variant')
    expect(m.getVariantGroup('conn-a', 'g1')?.winnerId).toBeUndefined()
    m.setVariantWinner('conn-a', 'g1', 's2')
    expect(m.getVariantGroup('conn-a', 'g1')?.winnerId).toBe('s2')
  })

  it('removeVariantGroup deletes only the targeted group', async () => {
    const m = await import('../../src/groups/store')
    m.recordVariantGroup('conn-a', group({ groupId: 'g1' }))
    m.recordVariantGroup('conn-a', group({ groupId: 'g2' }))
    m.removeVariantGroup('conn-a', 'g1')
    expect(m.groupsForConnection('conn-a').map((g) => g.groupId)).toEqual(['g2'])
  })

  it('clearConnectionGroups drops all groups for a connection', async () => {
    const m = await import('../../src/groups/store')
    m.recordVariantGroup('conn-a', group({ groupId: 'ga' }))
    m.recordVariantGroup('conn-b', group({ groupId: 'gb' }))
    m.clearConnectionGroups('conn-a')
    expect(m.groupsForConnection('conn-a')).toHaveLength(0)
    expect(m.groupsForConnection('conn-b')).toHaveLength(1)
  })

  it('variantGroupsSignal reflects updates reactively', async () => {
    const m = await import('../../src/groups/store')
    const sig = m.variantGroupsSignal('conn-a')
    expect(sig.value).toHaveLength(0)
    m.recordVariantGroup('conn-a', group())
    expect(sig.value).toHaveLength(1)
  })

  it('survives malformed localStorage by falling back to empty state', async () => {
    localStorage.setItem('minions-ui:variant-groups:v1', '{not json')
    const m = await import('../../src/groups/store')
    expect(m.groupsForConnection('conn-a')).toEqual([])
  })
})
