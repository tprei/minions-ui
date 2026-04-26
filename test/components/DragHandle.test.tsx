import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { DragHandle } from '../../src/components/DragHandle'

describe('DragHandle', () => {
  it('renders drag handle element', () => {
    render(<DragHandle />)
    const handle = screen.getByTestId('drag-handle')
    expect(handle).toBeDefined()
  })

  it('has accessible label', () => {
    render(<DragHandle />)
    const handle = screen.getByLabelText('Swipe down to dismiss')
    expect(handle).toBeDefined()
  })

  it('calls onPointerDown when pointer down event occurs', () => {
    const onPointerDown = vi.fn()
    render(<DragHandle onPointerDown={onPointerDown} />)
    const handle = screen.getByTestId('drag-handle')

    const event = new PointerEvent('pointerdown', { clientY: 100 })
    handle.dispatchEvent(event)

    expect(onPointerDown).toHaveBeenCalledWith(event)
  })

  it('calls onPointerMove when pointer move event occurs', () => {
    const onPointerMove = vi.fn()
    render(<DragHandle onPointerMove={onPointerMove} />)
    const handle = screen.getByTestId('drag-handle')

    const event = new PointerEvent('pointermove', { clientY: 150 })
    handle.dispatchEvent(event)

    expect(onPointerMove).toHaveBeenCalledWith(event)
  })

  it('calls onPointerUp when pointer up event occurs', () => {
    const onPointerUp = vi.fn()
    render(<DragHandle onPointerUp={onPointerUp} />)
    const handle = screen.getByTestId('drag-handle')

    const event = new PointerEvent('pointerup', { clientY: 200 })
    handle.dispatchEvent(event)

    expect(onPointerUp).toHaveBeenCalledWith(event)
  })

  it('has touch-none class to prevent default touch behavior', () => {
    render(<DragHandle />)
    const handle = screen.getByTestId('drag-handle')
    expect(handle.className).toContain('touch-none')
  })
})
