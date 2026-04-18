import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/preact'
import { ErrorBoundary, withErrorBoundary } from '../../src/components/ErrorBoundary'

let throwOnRender = false

function ThrowingComponent({ shouldThrow }: { shouldThrow?: boolean }) {
  if (shouldThrow ?? throwOnRender) {
    throw new Error('Test error message')
  }
  return <div>Normal content</div>
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello world</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('Hello world')).toBeTruthy()
  })

  it('renders default fallback on error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(screen.getByText('Test error message')).toBeTruthy()
  })

  it('renders custom fallback when provided', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const CustomFallback = ({ error }: { error: Error; reset: () => void }) => (
      <div>Custom: {error.message}</div>
    )

    render(
      <ErrorBoundary fallback={CustomFallback}>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    )
    expect(screen.getByText('Custom: Test error message')).toBeTruthy()
  })

  it('resets state when Try Again is clicked', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    throwOnRender = true
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeTruthy()

    throwOnRender = false
    fireEvent.click(screen.getByText('Try Again'))
    expect(screen.queryByText('Something went wrong')).toBeNull()
    expect(screen.getByText('Normal content')).toBeTruthy()
  })

  it('shows refresh suggestion text', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    )
    expect(screen.getByText(/If this keeps happening/)).toBeTruthy()
  })
})

describe('withErrorBoundary', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('wraps component and renders normally without errors', () => {
    const Wrapped = withErrorBoundary(ThrowingComponent)
    render(<Wrapped shouldThrow={false} />)
    expect(screen.getByText('Normal content')).toBeTruthy()
  })

  it('shows fallback when wrapped component throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Wrapped = withErrorBoundary(ThrowingComponent)
    render(<Wrapped shouldThrow={true} />)
    expect(screen.getByText('Something went wrong')).toBeTruthy()
  })
})
