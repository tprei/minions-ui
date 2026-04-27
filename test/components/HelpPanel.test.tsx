import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import { HelpPanel, HELP_SECTIONS } from '../../src/components/HelpPanel'

describe('HelpPanel', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <HelpPanel open={false} onClose={() => {}} onReplayTour={() => {}} />,
    )
    expect(container.querySelector('[data-testid="help-panel"]')).toBeNull()
  })

  it('renders all help sections when open=true', () => {
    render(<HelpPanel open={true} onClose={() => {}} onReplayTour={() => {}} />)
    expect(screen.getByTestId('help-panel')).toBeTruthy()
    for (const section of HELP_SECTIONS) {
      const node = screen.getByTestId(`help-section-${section.id}`)
      expect(node.textContent).toContain(section.title)
      expect(node.textContent).toContain(section.body)
    }
  })

  it('Close button calls onClose', () => {
    const onClose = vi.fn()
    render(<HelpPanel open={true} onClose={onClose} onReplayTour={() => {}} />)
    fireEvent.click(screen.getByTestId('help-panel-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking the overlay calls onClose', () => {
    const onClose = vi.fn()
    render(<HelpPanel open={true} onClose={onClose} onReplayTour={() => {}} />)
    fireEvent.click(screen.getByTestId('help-panel-overlay'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Replay tour button calls onReplayTour', () => {
    const onReplayTour = vi.fn()
    render(<HelpPanel open={true} onClose={() => {}} onReplayTour={onReplayTour} />)
    fireEvent.click(screen.getByTestId('help-panel-replay-tour'))
    expect(onReplayTour).toHaveBeenCalledTimes(1)
  })

  it('Escape key calls onClose', () => {
    const onClose = vi.fn()
    render(<HelpPanel open={true} onClose={onClose} onReplayTour={() => {}} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('lists all surfaces (List, Kanban, Canvas, Ship, long-press)', () => {
    render(<HelpPanel open={true} onClose={() => {}} onReplayTour={() => {}} />)
    expect(screen.getByTestId('help-section-list-view')).toBeTruthy()
    expect(screen.getByTestId('help-section-kanban-view')).toBeTruthy()
    expect(screen.getByTestId('help-section-canvas-view')).toBeTruthy()
    expect(screen.getByTestId('help-section-ship-view')).toBeTruthy()
    expect(screen.getByTestId('help-section-long-press')).toBeTruthy()
  })
})
