import { describe, test, expect } from 'bun:test'
import type { EngineEvent, EngineEventOfKind } from './types'

describe('Restack events', () => {
  test('dag.node.pushed event has required fields', () => {
    const event: EngineEventOfKind<'dag.node.pushed'> = {
      kind: 'dag.node.pushed',
      dagId: 'dag-123',
      nodeId: 'node-abc',
      parentSha: 'abc123',
      newSha: 'def456',
    }

    expect(event.kind).toBe('dag.node.pushed')
    expect(event.dagId).toBe('dag-123')
    expect(event.nodeId).toBe('node-abc')
    expect(event.parentSha).toBe('abc123')
    expect(event.newSha).toBe('def456')
  })

  test('dag.node.restack.started event has required fields', () => {
    const event: EngineEventOfKind<'dag.node.restack.started'> = {
      kind: 'dag.node.restack.started',
      dagId: 'dag-123',
      nodeId: 'node-child',
      parentNodeId: 'node-parent',
    }

    expect(event.kind).toBe('dag.node.restack.started')
    expect(event.dagId).toBe('dag-123')
    expect(event.nodeId).toBe('node-child')
    expect(event.parentNodeId).toBe('node-parent')
  })

  test('dag.node.restack.completed event with resolved result', () => {
    const event: EngineEventOfKind<'dag.node.restack.completed'> = {
      kind: 'dag.node.restack.completed',
      dagId: 'dag-123',
      nodeId: 'node-abc',
      result: 'resolved',
    }

    expect(event.kind).toBe('dag.node.restack.completed')
    expect(event.result).toBe('resolved')
  })

  test('dag.node.restack.completed event with conflict result and error', () => {
    const event: EngineEventOfKind<'dag.node.restack.completed'> = {
      kind: 'dag.node.restack.completed',
      dagId: 'dag-123',
      nodeId: 'node-abc',
      result: 'conflict',
      error: 'Failed to resolve merge conflicts in file.ts',
    }

    expect(event.kind).toBe('dag.node.restack.completed')
    expect(event.result).toBe('conflict')
    expect(event.error).toBe('Failed to resolve merge conflicts in file.ts')
  })

  test('all restack events are valid EngineEvent union members', () => {
    const pushedEvent: EngineEvent = {
      kind: 'dag.node.pushed',
      dagId: 'dag-1',
      nodeId: 'node-1',
      parentSha: 'sha1',
      newSha: 'sha2',
    }

    const startedEvent: EngineEvent = {
      kind: 'dag.node.restack.started',
      dagId: 'dag-1',
      nodeId: 'node-1',
      parentNodeId: 'parent-1',
    }

    const completedEvent: EngineEvent = {
      kind: 'dag.node.restack.completed',
      dagId: 'dag-1',
      nodeId: 'node-1',
      result: 'resolved',
    }

    expect(pushedEvent.kind).toBe('dag.node.pushed')
    expect(startedEvent.kind).toBe('dag.node.restack.started')
    expect(completedEvent.kind).toBe('dag.node.restack.completed')
  })
})
