import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/preact'
import {
  KeyboardShortcutsHelp,
  SHORTCUT_SECTIONS,
} from '../../src/components/KeyboardShortcutsHelp'

describe('KeyboardShortcutsHelp', () => {
  afterEach(() => cleanup())

  it('renders nothing when closed', () => {
    const { container } = render(
      <KeyboardShortcutsHelp open={false} onClose={() => {}} />,
    )
    expect(container.querySelector('[data-testid="keyboard-shortcuts-help"]')).toBeNull()
  })

  it('renders all sections and entries when open', () => {
    render(<KeyboardShortcutsHelp open={true} onClose={() => {}} />)
    for (const section of SHORTCUT_SECTIONS) {
      expect(screen.getByText(section.title)).toBeTruthy()
      for (let i = 0; i < section.entries.length; i++) {
        expect(
          screen.getByTestId(`shortcut-entry-${section.title}-${i}`),
        ).toBeTruthy()
      }
    }
  })

  it('closes when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<KeyboardShortcutsHelp open={true} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('keyboard-shortcuts-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<KeyboardShortcutsHelp open={true} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('keyboard-shortcuts-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<KeyboardShortcutsHelp open={true} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on ? toggle', () => {
    const onClose = vi.fn()
    render(<KeyboardShortcutsHelp open={true} onClose={onClose} />)
    fireEvent.keyDown(document, { key: '?' })
    expect(onClose).toHaveBeenCalled()
  })

  it('does not register listeners when closed', () => {
    const onClose = vi.fn()
    render(<KeyboardShortcutsHelp open={false} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
