import { describe, test, expect } from 'vitest'
import type {
  ShipStage,
  ApiSession,
  MinionCommand,
  CreateSessionMode,
  FeedbackVote,
  FeedbackReason,
  FeedbackMetadata,
} from '../../shared/api-types'

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

  test('ApiSession includes optional metadata field', () => {
    const sessionWithMeta: ApiSession = {
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
      mode: 'task',
      conversation: [],
      metadata: { kind: 'feedback', vote: 'up' },
    }
    expect(sessionWithMeta.metadata).toEqual({ kind: 'feedback', vote: 'up' })

    const sessionWithoutMeta: ApiSession = {
      id: 'test-id-2',
      slug: 'test-slug-2',
      status: 'pending',
      command: 'another command',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      childIds: [],
      needsAttention: false,
      attentionReasons: [],
      quickActions: [],
      mode: 'task',
      conversation: [],
    }
    expect(sessionWithoutMeta.metadata).toBeUndefined()
  })

  test('FeedbackVote type has correct values', () => {
    const validVotes: FeedbackVote[] = ['up', 'down']
    validVotes.forEach((vote) => {
      const v: FeedbackVote = vote
      expect(v).toBe(vote)
    })
  })

  test('FeedbackReason type has correct values', () => {
    const validReasons: FeedbackReason[] = ['incorrect', 'off_topic', 'too_verbose', 'unsafe', 'other']
    validReasons.forEach((reason) => {
      const r: FeedbackReason = reason
      expect(r).toBe(reason)
    })
  })

  test('FeedbackMetadata interface structure', () => {
    const feedbackMeta: FeedbackMetadata = {
      kind: 'feedback',
      vote: 'down',
      reason: 'incorrect',
      comment: 'The response was wrong',
      sourceSessionId: 'session-123',
      sourceSessionSlug: 'sharp-wood-0472',
      sourceMessageBlockId: 'block-456',
    }
    expect(feedbackMeta.kind).toBe('feedback')
    expect(feedbackMeta.vote).toBe('down')
    expect(feedbackMeta.reason).toBe('incorrect')
    expect(feedbackMeta.comment).toBe('The response was wrong')
    expect(feedbackMeta.sourceSessionId).toBe('session-123')
    expect(feedbackMeta.sourceSessionSlug).toBe('sharp-wood-0472')
    expect(feedbackMeta.sourceMessageBlockId).toBe('block-456')

    const minimalFeedbackMeta: FeedbackMetadata = {
      kind: 'feedback',
      vote: 'up',
      sourceSessionId: 'session-789',
      sourceSessionSlug: 'quiet-dune-1132',
      sourceMessageBlockId: 'block-101',
    }
    expect(minimalFeedbackMeta.reason).toBeUndefined()
    expect(minimalFeedbackMeta.comment).toBeUndefined()
  })

  test('MinionCommand includes submit_feedback action', () => {
    const feedbackCmdFull: MinionCommand = {
      action: 'submit_feedback',
      sessionId: 'test-session',
      messageBlockId: 'block-123',
      vote: 'down',
      reason: 'too_verbose',
      comment: 'Too long',
    }
    expect(feedbackCmdFull.action).toBe('submit_feedback')
    expect(feedbackCmdFull.vote).toBe('down')
    expect(feedbackCmdFull.reason).toBe('too_verbose')
    expect(feedbackCmdFull.comment).toBe('Too long')

    const feedbackCmdMinimal: MinionCommand = {
      action: 'submit_feedback',
      sessionId: 'test-session',
      messageBlockId: 'block-456',
      vote: 'up',
    }
    expect(feedbackCmdMinimal.action).toBe('submit_feedback')
    expect(feedbackCmdMinimal.vote).toBe('up')
    if ('reason' in feedbackCmdMinimal) {
      expect(feedbackCmdMinimal.reason).toBeUndefined()
    }
    if ('comment' in feedbackCmdMinimal) {
      expect(feedbackCmdMinimal.comment).toBeUndefined()
    }
  })
})
