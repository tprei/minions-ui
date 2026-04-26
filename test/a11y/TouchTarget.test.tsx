import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/preact'
import { TouchTarget } from '../../src/a11y/TouchTarget'
import { MIN_TOUCH_TARGET_SIZE } from '../../src/a11y/constants'

describe('a11y/TouchTarget', () => {
  describe('rendering', () => {
    it('renders children', () => {
      const { getByText } = render(<TouchTarget>Click me</TouchTarget>)
      expect(getByText('Click me')).toBeTruthy()
    })

    it('renders as button when onClick provided', () => {
      const { container } = render(<TouchTarget onClick={() => {}}>Click</TouchTarget>)
      const button = container.querySelector('button')
      expect(button).toBeTruthy()
    })

    it('renders as div when no interactive props provided', () => {
      const { container } = render(<TouchTarget>Static</TouchTarget>)
      const div = container.querySelector('div')
      expect(div).toBeTruthy()
    })

    it('applies custom className', () => {
      const { container } = render(<TouchTarget className="custom-class">Test</TouchTarget>)
      const element = container.firstChild as HTMLElement
      expect(element.className).toContain('custom-class')
    })

    it('applies default minimum size', () => {
      const { container } = render(<TouchTarget>Test</TouchTarget>)
      const element = container.firstChild as HTMLElement
      expect(element.style.minWidth).toBe(`${MIN_TOUCH_TARGET_SIZE}px`)
      expect(element.style.minHeight).toBe(`${MIN_TOUCH_TARGET_SIZE}px`)
    })

    it('applies custom minimum size', () => {
      const customSize = 60
      const { container } = render(<TouchTarget minSize={customSize}>Test</TouchTarget>)
      const element = container.firstChild as HTMLElement
      expect(element.style.minWidth).toBe(`${customSize}px`)
      expect(element.style.minHeight).toBe(`${customSize}px`)
    })

    it('includes flexbox centering classes', () => {
      const { container } = render(<TouchTarget>Test</TouchTarget>)
      const element = container.firstChild as HTMLElement
      expect(element.className).toContain('inline-flex')
      expect(element.className).toContain('items-center')
      expect(element.className).toContain('justify-center')
    })
  })

  describe('accessibility attributes', () => {
    it('sets aria-label when provided', () => {
      const { container } = render(<TouchTarget ariaLabel="Close button">×</TouchTarget>)
      const element = container.firstChild as HTMLElement
      expect(element.getAttribute('aria-label')).toBe('Close button')
    })

    it('sets aria-pressed when provided', () => {
      const { container } = render(
        <TouchTarget ariaPressed={true} onClick={() => {}}>
          Toggle
        </TouchTarget>
      )
      const element = container.firstChild as HTMLElement
      expect(element.getAttribute('aria-pressed')).toBe('true')
    })

    it('sets custom role when provided', () => {
      const { container } = render(<TouchTarget role="checkbox">Check</TouchTarget>)
      const element = container.firstChild as HTMLElement
      expect(element.getAttribute('role')).toBe('checkbox')
    })

    it('sets role=button for non-button elements by default', () => {
      const { container } = render(<TouchTarget>Static</TouchTarget>)
      const element = container.firstChild as HTMLElement
      expect(element.getAttribute('role')).toBe('button')
    })

    it('does not set role for button elements', () => {
      const { container } = render(<TouchTarget onClick={() => {}}>Click</TouchTarget>)
      const element = container.firstChild as HTMLElement
      expect(element.getAttribute('role')).toBeNull()
    })

    it('sets tabIndex to 0 by default for enabled elements', () => {
      const { container } = render(<TouchTarget>Test</TouchTarget>)
      const element = container.firstChild as HTMLElement
      expect(element.getAttribute('tabindex')).toBe('0')
    })

    it('sets tabIndex to -1 when disabled', () => {
      const { container } = render(<TouchTarget disabled>Test</TouchTarget>)
      const element = container.firstChild as HTMLElement
      expect(element.getAttribute('tabindex')).toBe('-1')
    })

    it('respects custom tabIndex', () => {
      const { container } = render(<TouchTarget tabIndex={2}>Test</TouchTarget>)
      const element = container.firstChild as HTMLElement
      expect(element.getAttribute('tabindex')).toBe('2')
    })
  })

  describe('button behavior', () => {
    it('sets button type when specified', () => {
      const { container } = render(
        <TouchTarget type="submit" onClick={() => {}}>
          Submit
        </TouchTarget>
      )
      const button = container.querySelector('button')
      expect(button?.getAttribute('type')).toBe('submit')
    })

    it('defaults to type=button', () => {
      const { container } = render(<TouchTarget onClick={() => {}}>Click</TouchTarget>)
      const button = container.querySelector('button')
      expect(button?.getAttribute('type')).toBe('button')
    })

    it('sets disabled attribute on button', () => {
      const { container } = render(
        <TouchTarget disabled onClick={() => {}}>
          Disabled
        </TouchTarget>
      )
      const button = container.querySelector('button')
      expect(button?.disabled).toBe(true)
    })

    it('does not set disabled on div elements', () => {
      const { container } = render(<TouchTarget disabled>Static</TouchTarget>)
      const div = container.querySelector('div')
      expect(div?.hasAttribute('disabled')).toBe(false)
    })
  })

  describe('event handlers', () => {
    it('calls onClick handler when clicked', () => {
      const onClick = vi.fn()
      const { container } = render(<TouchTarget onClick={onClick}>Click</TouchTarget>)
      const button = container.querySelector('button')!
      fireEvent.click(button)
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('calls onPointerDown handler', () => {
      const onPointerDown = vi.fn()
      const { container } = render(<TouchTarget onPointerDown={onPointerDown}>Press</TouchTarget>)
      const button = container.querySelector('button')!
      fireEvent.pointerDown(button)
      expect(onPointerDown).toHaveBeenCalledTimes(1)
    })

    it('calls onPointerUp handler', () => {
      const onPointerUp = vi.fn()
      const { container } = render(<TouchTarget onPointerUp={onPointerUp}>Release</TouchTarget>)
      const button = container.querySelector('button')!
      fireEvent.pointerUp(button)
      expect(onPointerUp).toHaveBeenCalledTimes(1)
    })

    it('has disabled attribute when disabled prop is true', () => {
      const onClick = vi.fn()
      const { container } = render(
        <TouchTarget disabled onClick={onClick}>
          Disabled
        </TouchTarget>
      )
      const button = container.querySelector('button')!
      expect(button.disabled).toBe(true)
    })

    it('renders as button when onPointerDown is provided', () => {
      const { container } = render(<TouchTarget onPointerDown={() => {}}>Press</TouchTarget>)
      expect(container.querySelector('button')).toBeTruthy()
    })

    it('renders as button when onPointerUp is provided', () => {
      const { container } = render(<TouchTarget onPointerUp={() => {}}>Release</TouchTarget>)
      expect(container.querySelector('button')).toBeTruthy()
    })
  })

  describe('compound props', () => {
    it('combines all interactive handlers', () => {
      const onClick = vi.fn()
      const onPointerDown = vi.fn()
      const onPointerUp = vi.fn()
      const { container } = render(
        <TouchTarget onClick={onClick} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
          Interactive
        </TouchTarget>
      )
      const button = container.querySelector('button')!
      fireEvent.pointerDown(button)
      fireEvent.pointerUp(button)
      fireEvent.click(button)
      expect(onPointerDown).toHaveBeenCalledTimes(1)
      expect(onPointerUp).toHaveBeenCalledTimes(1)
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('combines className with default classes', () => {
      const { container } = render(<TouchTarget className="text-red-500">Test</TouchTarget>)
      const element = container.firstChild as HTMLElement
      expect(element.className).toContain('inline-flex')
      expect(element.className).toContain('items-center')
      expect(element.className).toContain('justify-center')
      expect(element.className).toContain('text-red-500')
    })
  })
})
