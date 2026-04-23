import { render, screen, fireEvent, waitFor } from '@testing-library/preact'
import { describe, it, expect, vi } from 'vitest'
import { SlashCommandMenu } from '../../src/chat/SlashCommandMenu'
import type { ApiSession } from '../../src/api/types'

function makeSession(mode: string): ApiSession {
  return {
    id: 's1',
    slug: 'foo',
    status: 'running',
    command: '/task foo',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode,
    conversation: [],
  }
}

describe('SlashCommandMenu', () => {
  it('shows plan-mode commands when session.mode is plan', () => {
    render(<SlashCommandMenu session={makeSession('plan')} context="" onPrefill={() => {}} />)
    expect(screen.getByTestId('slash-cmd-execute')).toBeTruthy()
    expect(screen.getByTestId('slash-cmd-split')).toBeTruthy()
    expect(screen.getByTestId('slash-cmd-stack')).toBeTruthy()
    expect(screen.getByTestId('slash-cmd-dag')).toBeTruthy()
  })

  it('shows task-mode commands when session.mode is task', () => {
    render(<SlashCommandMenu session={makeSession('task')} context="" onPrefill={() => {}} />)
    expect(screen.getByTestId('slash-cmd-doctor')).toBeTruthy()
    expect(screen.getByTestId('slash-cmd-stop')).toBeTruthy()
    expect(screen.getByTestId('slash-cmd-close')).toBeTruthy()
  })

  it('sends the command alone when context is empty', async () => {
    const onCommand = vi.fn()
    render(<SlashCommandMenu session={makeSession('plan')} context="" onPrefill={onCommand} />)
    fireEvent.click(screen.getByTestId('slash-cmd-execute'))
    await waitFor(() => expect(onCommand).toHaveBeenCalled())
    expect(onCommand.mock.calls[0][0]).toBe('/execute')
  })

  it('appends context after the command when context is set', async () => {
    const onCommand = vi.fn()
    render(<SlashCommandMenu session={makeSession('plan')} context="focus on auth" onPrefill={onCommand} />)
    fireEvent.click(screen.getByTestId('slash-cmd-execute'))
    await waitFor(() => expect(onCommand).toHaveBeenCalled())
    expect(onCommand.mock.calls[0][0]).toBe('/execute focus on auth')
  })

  it('trims whitespace from context', async () => {
    const onCommand = vi.fn()
    render(<SlashCommandMenu session={makeSession('plan')} context="  pad  " onPrefill={onCommand} />)
    fireEvent.click(screen.getByTestId('slash-cmd-execute'))
    await waitFor(() => expect(onCommand).toHaveBeenCalled())
    expect(onCommand.mock.calls[0][0]).toBe('/execute pad')
  })

  it('marks destructive buttons with different styling', () => {
    render(<SlashCommandMenu session={makeSession('task')} context="" onPrefill={() => {}} />)
    const stop = screen.getByTestId('slash-cmd-stop')
    expect(stop.className).toContain('text-red-700')
  })
})
