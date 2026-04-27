import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import {
  useGlobalShortcuts,
  isTextInputTarget,
  type GlobalShortcutHandlers,
} from '../../src/hooks/useGlobalShortcuts'

function Harness(props: GlobalShortcutHandlers) {
  useGlobalShortcuts(props)
  return (
    <div>
      <input data-testid="text-input" />
      <textarea data-testid="textarea" />
    </div>
  )
}

afterEach(() => cleanup())

describe('isTextInputTarget', () => {
  it('returns true for INPUT, TEXTAREA, SELECT', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    expect(isTextInputTarget(input)).toBe(true)
    expect(isTextInputTarget(textarea)).toBe(true)
    expect(isTextInputTarget(select)).toBe(true)
  })
  it('returns false for other elements', () => {
    const div = document.createElement('div')
    expect(isTextInputTarget(div)).toBe(false)
    expect(isTextInputTarget(null)).toBe(false)
  })
})

describe('useGlobalShortcuts', () => {
  it('opens palette on Cmd+K', () => {
    const onOpenPalette = vi.fn()
    render(<Harness onOpenPalette={onOpenPalette} onOpenHelp={() => {}} />)
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    expect(onOpenPalette).toHaveBeenCalledTimes(1)
  })

  it('opens palette on Ctrl+K', () => {
    const onOpenPalette = vi.fn()
    render(<Harness onOpenPalette={onOpenPalette} onOpenHelp={() => {}} />)
    fireEvent.keyDown(document, { key: 'K', ctrlKey: true })
    expect(onOpenPalette).toHaveBeenCalledTimes(1)
  })

  it('opens palette even when focus is in a text input (Cmd+K is global)', () => {
    const onOpenPalette = vi.fn()
    const { getByTestId } = render(
      <Harness onOpenPalette={onOpenPalette} onOpenHelp={() => {}} />,
    )
    const input = getByTestId('text-input') as HTMLInputElement
    input.focus()
    fireEvent.keyDown(input, { key: 'k', metaKey: true })
    expect(onOpenPalette).toHaveBeenCalled()
  })

  it('opens help on ?', () => {
    const onOpenHelp = vi.fn()
    render(<Harness onOpenPalette={() => {}} onOpenHelp={onOpenHelp} />)
    fireEvent.keyDown(document, { key: '?' })
    expect(onOpenHelp).toHaveBeenCalledTimes(1)
  })

  it('triggers onNewTask on n', () => {
    const onNewTask = vi.fn()
    render(
      <Harness
        onOpenPalette={() => {}}
        onOpenHelp={() => {}}
        onNewTask={onNewTask}
      />,
    )
    fireEvent.keyDown(document, { key: 'n' })
    expect(onNewTask).toHaveBeenCalledTimes(1)
  })

  it('triggers onRefresh on r', () => {
    const onRefresh = vi.fn()
    render(
      <Harness
        onOpenPalette={() => {}}
        onOpenHelp={() => {}}
        onRefresh={onRefresh}
      />,
    )
    fireEvent.keyDown(document, { key: 'r' })
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('handles g-then-c chord for canvas view', () => {
    const onSwitchView = vi.fn()
    render(
      <Harness
        onOpenPalette={() => {}}
        onOpenHelp={() => {}}
        onSwitchView={onSwitchView}
      />,
    )
    fireEvent.keyDown(document, { key: 'g' })
    fireEvent.keyDown(document, { key: 'c' })
    expect(onSwitchView).toHaveBeenCalledWith('canvas')
  })

  it('handles g-then-l chord for list view', () => {
    const onSwitchView = vi.fn()
    render(
      <Harness
        onOpenPalette={() => {}}
        onOpenHelp={() => {}}
        onSwitchView={onSwitchView}
      />,
    )
    fireEvent.keyDown(document, { key: 'g' })
    fireEvent.keyDown(document, { key: 'l' })
    expect(onSwitchView).toHaveBeenCalledWith('list')
  })

  it('handles g-then-s chord for ship view', () => {
    const onSwitchView = vi.fn()
    render(
      <Harness
        onOpenPalette={() => {}}
        onOpenHelp={() => {}}
        onSwitchView={onSwitchView}
      />,
    )
    fireEvent.keyDown(document, { key: 'g' })
    fireEvent.keyDown(document, { key: 's' })
    expect(onSwitchView).toHaveBeenCalledWith('ship')
  })

  it('does not fire single-key shortcuts when focus is in an input', () => {
    const onNewTask = vi.fn()
    const onOpenHelp = vi.fn()
    const { getByTestId } = render(
      <Harness
        onOpenPalette={() => {}}
        onOpenHelp={onOpenHelp}
        onNewTask={onNewTask}
      />,
    )
    const input = getByTestId('text-input') as HTMLInputElement
    input.focus()
    fireEvent.keyDown(input, { key: 'n' })
    fireEvent.keyDown(input, { key: '?' })
    expect(onNewTask).not.toHaveBeenCalled()
    expect(onOpenHelp).not.toHaveBeenCalled()
  })

  it('does not fire single-key shortcuts when modifier keys are held', () => {
    const onNewTask = vi.fn()
    render(
      <Harness
        onOpenPalette={() => {}}
        onOpenHelp={() => {}}
        onNewTask={onNewTask}
      />,
    )
    fireEvent.keyDown(document, { key: 'n', ctrlKey: true })
    expect(onNewTask).not.toHaveBeenCalled()
  })
})
