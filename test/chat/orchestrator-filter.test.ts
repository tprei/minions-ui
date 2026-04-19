import { describe, it, expect } from 'vitest'
import { isOrchestratorStatus } from '../../src/chat/orchestrator-filter'

describe('isOrchestratorStatus', () => {
  const blocked = [
    '🔗 DAG: 7 tasks  ·  🏷 rich-shore',
    '🔗 DAG · rich-shore · minions-ui',
    '📊 🔗 DAG Status',
    '📊 DAG complete: 7/7 succeeded',
    '📊 5/7 complete',
    '📊 5/7 complete, 1 running',
    '⚡ Starting: API foundation (api-foundation)',
    '⚡ DAG recovered after restart — some nodes were transitioned.',
    '🔄 salt-cap waiting for CI: …',
    '✅ salt-cap completed: API foundation',
    '✅ salt-cap (https://t.me/c/3816475740/24754) completed: API foundation: types',
    '❌ gold-tor failed: PR preview card',
    '⚠️ full-rock completed without a PR — spawning recovery session…',
    '🚢 Ship: dag complete · 🏷 rich-shore',
    '⚖️ Verdict',
    '🗣 Advocate: some-option — …',
    '🔍 Pre-flight check',
    '⚠️ Pre-flight failed at: unknown node',
    '⏳ Pipeline is advancing to the next phase.',
    '📚 Stack: 4 tasks',
    '✅ Ship complete · 🏷 rich-shore',
  ]

  const passed = [
    '/retry',
    '/land',
    'Here is my actual reply.',
    'Working on something useful.',
    '- [x] plan complete',
    '⚙️ something custom the model typed',
  ]

  for (const t of blocked) {
    it(`hides: ${JSON.stringify(t.slice(0, 40))}`, () => {
      expect(isOrchestratorStatus(t)).toBe(true)
    })
  }

  for (const t of passed) {
    it(`shows: ${JSON.stringify(t.slice(0, 40))}`, () => {
      expect(isOrchestratorStatus(t)).toBe(false)
    })
  }
})
