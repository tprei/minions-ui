import { describe, test, expect } from 'bun:test'

describe('summarizeConversation', () => {
  test.skip('live call — skipped by default', async () => {
    const { summarizeConversation } = await import('./summarizer')
    const conv = [
      { role: 'user', text: 'Fix the bug in the login form.' },
      { role: 'assistant', text: 'I found and fixed the null-check issue in validateEmail.' },
    ]
    const result = await summarizeConversation(conv)
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(500)
  })

  test('summarizeConversation is a function', async () => {
    const mod = await import('./summarizer')
    expect(typeof mod.summarizeConversation).toBe('function')
  })
})
