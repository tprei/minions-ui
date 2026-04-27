import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/preact'
import { StatusIndicator, statusDot, statusGlyph } from '../../src/components/SessionList'
import type { ApiSession } from '../../src/api/types'

describe('statusDot', () => {
  it('returns a pulsing blue class for running', () => {
    expect(statusDot('running')).toContain('bg-blue-500')
    expect(statusDot('running')).toContain('animate-pulse')
  })

  it('returns green for completed and red for failed', () => {
    expect(statusDot('completed')).toContain('bg-green-500')
    expect(statusDot('failed')).toContain('bg-red-500')
  })

  it('returns slate for any other status', () => {
    expect(statusDot('pending')).toContain('bg-slate-400')
    expect(statusDot('skipped' as ApiSession['status'])).toContain('bg-slate-400')
  })
})

describe('statusGlyph', () => {
  it('returns ⟳ for running', () => {
    expect(statusGlyph('running')).toBe('⟳')
  })

  it('returns ✓ for completed', () => {
    expect(statusGlyph('completed')).toBe('✓')
  })

  it('returns ! for failed', () => {
    expect(statusGlyph('failed')).toBe('!')
  })

  it('returns · for any other status', () => {
    expect(statusGlyph('pending')).toBe('·')
    expect(statusGlyph('skipped' as ApiSession['status'])).toBe('·')
  })
})

describe('StatusIndicator', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders both a dot and a glyph for the given status', () => {
    render(<StatusIndicator status="running" />)
    const wrapper = screen.getByTestId('status-indicator-running')
    expect(wrapper).toBeTruthy()
    const dot = wrapper.querySelector('span.bg-blue-500')
    expect(dot).toBeTruthy()
    expect(screen.getByTestId('status-glyph-running').textContent).toBe('⟳')
  })

  it('renders the completed glyph and dot together', () => {
    render(<StatusIndicator status="completed" />)
    expect(screen.getByTestId('status-glyph-completed').textContent).toBe('✓')
    expect(screen.getByTestId('status-indicator-completed').querySelector('span.bg-green-500')).toBeTruthy()
  })

  it('renders the failed glyph and dot together', () => {
    render(<StatusIndicator status="failed" />)
    expect(screen.getByTestId('status-glyph-failed').textContent).toBe('!')
    expect(screen.getByTestId('status-indicator-failed').querySelector('span.bg-red-500')).toBeTruthy()
  })

  it('uses the provided label as accessible name', () => {
    render(<StatusIndicator status="running" label="bold-meadow: running" />)
    const wrapper = screen.getByTestId('status-indicator-running')
    expect(wrapper.getAttribute('aria-label')).toBe('bold-meadow: running')
    expect(wrapper.getAttribute('role')).toBe('img')
  })

  it('falls back to a generic accessible label when not provided', () => {
    render(<StatusIndicator status="completed" />)
    const wrapper = screen.getByTestId('status-indicator-completed')
    expect(wrapper.getAttribute('aria-label')).toBe('Status: completed')
  })

  it('marks the dot and glyph as aria-hidden so screen readers only see the wrapper', () => {
    render(<StatusIndicator status="running" />)
    const wrapper = screen.getByTestId('status-indicator-running')
    const children = wrapper.querySelectorAll('span[aria-hidden="true"]')
    expect(children.length).toBe(2)
  })
})
