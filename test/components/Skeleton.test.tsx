import { render } from '@testing-library/preact'
import { describe, it, expect } from 'vitest'
import { Skeleton, SkeletonLines } from '../../src/components/Skeleton'

describe('Skeleton', () => {
  it('renders with the default pulse classes and md rounding', () => {
    const { container } = render(<Skeleton data-testid="s1" />)
    const el = container.querySelector('[data-testid="s1"]')!
    expect(el.className).toContain('animate-pulse')
    expect(el.className).toContain('bg-slate-200')
    expect(el.className).toContain('rounded-md')
    expect(el.getAttribute('aria-hidden')).toBe('true')
  })

  it('applies width/height style when provided', () => {
    const { container } = render(<Skeleton width={100} height={12} rounded="full" />)
    const el = container.querySelector('div') as HTMLElement
    expect(el.style.width).toBe('100px')
    expect(el.style.height).toBe('12px')
    expect(el.className).toContain('rounded-full')
  })
})

describe('SkeletonLines', () => {
  it('renders the requested number of lines', () => {
    const { container } = render(<SkeletonLines count={4} />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.children.length).toBe(4)
  })

  it('renders 3 lines by default with the last shorter', () => {
    const { container } = render(<SkeletonLines />)
    const wrapper = container.firstElementChild as HTMLElement
    const lines = Array.from(wrapper.children) as HTMLElement[]
    expect(lines.length).toBe(3)
    expect(lines[lines.length - 1].style.width).toBe('60%')
  })
})
