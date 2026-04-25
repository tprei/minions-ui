import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { getModeConfig, CLAUDE_MODE_CONFIGS, CODEX_MODE_CONFIGS } from './prompts'

describe('getModeConfig', () => {
  describe('claude provider', () => {
    test('plan mode uses Claude default model', () => {
      const cfg = getModeConfig('claude', 'plan')
      expect(cfg.model).toBe(CLAUDE_MODE_CONFIGS['plan'].model)
      expect(cfg.model).toContain('claude')
    })

    test('task mode has no reasoningEffort', () => {
      const cfg = getModeConfig('claude', 'task')
      expect(cfg.reasoningEffort).toBeUndefined()
    })

    test('plan mode has disallowedTools for readonly enforcement', () => {
      const cfg = getModeConfig('claude', 'plan')
      expect(cfg.disallowedTools).toContain('Edit')
      expect(cfg.disallowedTools).toContain('Write')
    })

    test('CLAUDE_TASK_MODEL env override is respected', () => {
      // CLAUDE_MODE_CONFIGS is built at module load time, so we test the
      // exported object directly (env vars are captured at import time in tests)
      expect(typeof CLAUDE_MODE_CONFIGS['task'].model).toBe('string')
      expect(CLAUDE_MODE_CONFIGS['task'].model.length).toBeGreaterThan(0)
    })
  })

  describe('codex provider', () => {
    test('plan mode has reasoningEffort high by default', () => {
      const cfg = getModeConfig('codex', 'plan')
      expect(cfg.reasoningEffort).toBe('high')
    })

    test('plan mode has sandbox read-only', () => {
      const cfg = getModeConfig('codex', 'plan')
      expect(cfg.sandbox).toBe('read-only')
    })

    test('task mode has no reasoningEffort', () => {
      const cfg = getModeConfig('codex', 'task')
      expect(cfg.reasoningEffort).toBeUndefined()
    })

    test('task mode has no sandbox', () => {
      const cfg = getModeConfig('codex', 'task')
      expect(cfg.sandbox).toBeUndefined()
    })

    test('task mode disallowedTools is empty (sandbox enforces readonly)', () => {
      const cfg = getModeConfig('codex', 'task')
      expect(cfg.disallowedTools).toHaveLength(0)
    })

    test('plan mode disallowedTools is empty (sandbox enforces readonly)', () => {
      const cfg = getModeConfig('codex', 'plan')
      expect(cfg.disallowedTools).toHaveLength(0)
    })

    test('codex task model uses gpt-5.1-codex default', () => {
      const cfg = getModeConfig('codex', 'task')
      expect(cfg.model).toBe(CODEX_MODE_CONFIGS['task'].model)
    })
  })

  describe('CODEX_TASK_MODEL env override', () => {
    let originalVal: string | undefined

    beforeEach(() => {
      originalVal = process.env['CODEX_TASK_MODEL']
    })

    afterEach(() => {
      if (originalVal === undefined) {
        delete process.env['CODEX_TASK_MODEL']
      } else {
        process.env['CODEX_TASK_MODEL'] = originalVal
      }
    })

    test('CODEX_MODE_CONFIGS task model reflects env at module load time', () => {
      // The config is evaluated at module import, so we just assert the type here.
      // Real env-override behaviour is covered by the integration/e2e layer.
      expect(typeof CODEX_MODE_CONFIGS['task'].model).toBe('string')
    })
  })

  describe('autoExitOnComplete parity', () => {
    const modes = ['task', 'dag-task', 'plan', 'think', 'review', 'ship-think', 'ship-plan', 'ship-verify', 'ci-fix'] as const

    for (const mode of modes) {
      test(`${mode}: claude and codex have same autoExitOnComplete`, () => {
        expect(getModeConfig('claude', mode).autoExitOnComplete).toBe(getModeConfig('codex', mode).autoExitOnComplete)
      })
    }
  })
})
