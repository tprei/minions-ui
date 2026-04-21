import { describe, test, expect } from 'bun:test'
import { handleDoctorCommand } from './doctor'

describe('handleDoctorCommand', () => {
  test('returns text with check lines', async () => {
    const result = await handleDoctorCommand()
    expect(typeof result.text).toBe('string')
    expect(result.text!.length).toBeGreaterThan(0)
  })

  test('text contains check badges', async () => {
    const result = await handleDoctorCommand()
    const hasBadge = result.text?.includes('[ok]') || result.text?.includes('[warn]') || result.text?.includes('[fail]')
    expect(hasBadge).toBe(true)
  })
})
