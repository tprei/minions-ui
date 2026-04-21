import { describe, test, expect } from 'bun:test'
import { handleHelpCommand } from './help'

describe('handleHelpCommand', () => {
  test('returns ok=true', () => {
    const result = handleHelpCommand()
    expect(result.ok).toBe(true)
  })

  test('text contains section headers', () => {
    const { text } = handleHelpCommand()
    expect(text).toContain('Task / Plan / Think / Review')
    expect(text).toContain('DAG / Split / Stack')
    expect(text).toContain('Status')
    expect(text).toContain('Loops')
    expect(text).toContain('Config')
    expect(text).toContain('Utility')
  })

  test('text lists core commands', () => {
    const { text } = handleHelpCommand()
    expect(text).toContain('/task')
    expect(text).toContain('/plan')
    expect(text).toContain('/dag')
    expect(text).toContain('/split')
    expect(text).toContain('/stack')
    expect(text).toContain('/judge')
    expect(text).toContain('/retry')
    expect(text).toContain('/force')
    expect(text).toContain('/land')
    expect(text).toContain('/reply')
    expect(text).toContain('/status')
    expect(text).toContain('/stats')
    expect(text).toContain('/usage')
    expect(text).toContain('/clean')
    expect(text).toContain('/doctor')
    expect(text).toContain('/loops')
    expect(text).toContain('/config')
    expect(text).toContain('/done')
    expect(text).toContain('/help')
  })
})
