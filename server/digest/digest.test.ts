import { describe, test, expect } from 'bun:test'
import { buildConversationDigest, buildChildSessionDigest } from './digest'

const fixedConversation = [
  { role: 'user', text: 'What is the capital of France?' },
  { role: 'assistant', text: 'The capital of France is Paris.' },
  { role: 'user', text: 'And Germany?' },
  { role: 'assistant', text: 'The capital of Germany is Berlin.' },
]

describe('buildConversationDigest', () => {
  test('produces deterministic output for fixed input', () => {
    const a = buildConversationDigest(fixedConversation)
    const b = buildConversationDigest(fixedConversation)
    expect(a).toBe(b)
  })

  test('wraps output in details/summary', () => {
    const result = buildConversationDigest(fixedConversation)
    expect(result).toContain('<details>')
    expect(result).toContain('<summary>')
    expect(result).toContain('</details>')
  })

  test('includes user and agent messages', () => {
    const result = buildConversationDigest(fixedConversation)
    expect(result).toContain('What is the capital of France?')
    expect(result).toContain('Paris')
  })

  test('returns empty string for empty conversation', () => {
    expect(buildConversationDigest([])).toBe('')
  })

  test('strips <tool_use_id> blocks', () => {
    const conv = [
      { role: 'assistant', text: 'Running <tool_use_id>toolu_abc123</tool_use_id> to check.' },
    ]
    const result = buildConversationDigest(conv)
    expect(result).not.toContain('toolu_abc123')
    expect(result).toContain('Running')
  })

  test('caps individual messages at 500 chars', () => {
    const long = 'x'.repeat(1000)
    const conv = [{ role: 'assistant', text: long }]
    const result = buildConversationDigest(conv)
    expect(result).toContain('…[truncated]')
  })

  test('respects 3000 char total budget', () => {
    const conv = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: 'word '.repeat(60),
    }))
    const result = buildConversationDigest(conv)
    expect(result.length).toBeLessThanOrEqual(3500)
  })
})

describe('buildChildSessionDigest', () => {
  test('includes parent context when parentConversation is provided', () => {
    const result = buildChildSessionDigest({
      childConversation: fixedConversation,
      parentConversation: [{ role: 'user', text: 'Parent question here' }],
    })
    expect(result).toContain('Parent context')
    expect(result).toContain('Parent question here')
  })

  test('does not include parent context when not provided', () => {
    const result = buildChildSessionDigest({
      childConversation: fixedConversation,
    })
    expect(result).not.toContain('Parent context')
  })
})
