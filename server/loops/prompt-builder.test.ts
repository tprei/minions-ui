import { describe, test, expect } from 'bun:test'
import { buildLoopPrompt } from './prompt-builder'
import type { LoopDefinition } from './definitions'

const testDef: LoopDefinition = {
  id: 'test-coverage',
  title: 'Test Coverage',
  description: 'Improve coverage',
  intervalMs: 8 * 60 * 60 * 1000,
  branchPrefix: 'minions/loops/test-coverage',
  promptTemplate: 'Run the tests and improve coverage.',
}

describe('buildLoopPrompt', () => {
  test('includes task description', () => {
    const prompt = buildLoopPrompt(testDef, [])
    expect(prompt).toContain('Run the tests and improve coverage.')
  })

  test('includes existing-PR instruction with correct branch name', () => {
    const prompt = buildLoopPrompt(testDef, [])
    expect(prompt).toContain('minions/loops/test-coverage')
    expect(prompt).toContain('PR already exists')
  })

  test('includes existing PR URL when provided', () => {
    const prompt = buildLoopPrompt(testDef, [], { existingPrUrl: 'https://github.com/org/repo/pull/7' })
    expect(prompt).toContain('https://github.com/org/repo/pull/7')
  })

  test('includes run history entries when present', () => {
    const history = [
      { ranAt: 1_700_000_000_000, state: 'completed', prUrl: 'https://github.com/org/repo/pull/1' },
      { ranAt: 1_700_100_000_000, state: 'errored' },
    ]
    const prompt = buildLoopPrompt(testDef, history)
    expect(prompt).toContain('Previous runs')
    expect(prompt).toContain('completed')
    expect(prompt).toContain('errored')
    expect(prompt).toContain('https://github.com/org/repo/pull/1')
  })

  test('does not include run history section when history is empty', () => {
    const prompt = buildLoopPrompt(testDef, [])
    expect(prompt).not.toContain('Previous runs')
  })

  test('does not contain post-task-router', () => {
    const prompt = buildLoopPrompt(testDef, [])
    expect(prompt).not.toContain('post-task-router')
  })

  test('includes loop title as heading', () => {
    const prompt = buildLoopPrompt(testDef, [])
    expect(prompt).toContain('# Test Coverage')
  })
})
