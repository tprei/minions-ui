import { describe, test, expect } from 'vitest'
import type { ShipStage, ApiSession, MinionCommand, CreateSessionMode } from '../../shared/api-types'

describe('api-types', () => {
  test('ShipStage type has correct values', () => {
    const validStages: ShipStage[] = ['think', 'plan', 'dag', 'verify', 'done']
    validStages.forEach((stage) => {
      const s: ShipStage = stage
      expect(s).toBe(stage)
    })
  })

  test('ApiSession interface includes stage field', () => {
    const session: ApiSession = {
      id: 'test-id',
      slug: 'test-slug',
      status: 'running',
      command: 'test command',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      childIds: [],
      needsAttention: false,
      attentionReasons: [],
      quickActions: [],
      mode: 'ship',
      stage: 'think',
      conversation: [],
    }
    expect(session.stage).toBe('think')
  })

  test('MinionCommand includes ship_advance action', () => {
    const cmd1: MinionCommand = { action: 'ship_advance', sessionId: 'test-id', to: 'plan' }
    expect(cmd1.action).toBe('ship_advance')

    const cmd2: MinionCommand = { action: 'ship_advance', sessionId: 'test-id' }
    expect(cmd2.action).toBe('ship_advance')
  })

  test('CreateSessionMode includes ship but not old modes', () => {
    const validModes: CreateSessionMode[] = ['task', 'dag-task', 'plan', 'think', 'review', 'ship']
    validModes.forEach((mode) => {
      const m: CreateSessionMode = mode
      expect(m).toBe(mode)
    })
  })
})
