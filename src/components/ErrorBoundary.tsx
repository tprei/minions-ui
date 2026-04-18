import { Component, type ComponentType, type FunctionalComponent } from 'preact'
import { useTheme } from '../hooks/useTheme'

interface ErrorBoundaryProps {
  children: preact.ComponentChildren
  fallback?: FunctionalComponent<{ error: Error; reset: () => void }>
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: preact.ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): preact.ComponentChildren {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback
        return <FallbackComponent error={this.state.error} reset={this.handleReset} />
      }

      return <DefaultFallback error={this.state.error} reset={this.handleReset} />
    }

    return this.props.children
  }
}

interface FallbackProps {
  error: Error
  reset: () => void
}

function DefaultFallback({ error, reset }: FallbackProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'

  return (
    <div
      class={`min-h-screen p-4 flex flex-col items-center justify-center ${isDark ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}
    >
      <div class="max-w-md w-full text-center">
        <div class="text-4xl mb-4">⚠️</div>
        <h1 class="text-xl font-bold mb-2">Something went wrong</h1>
        <p
          class={`text-sm mb-4 font-mono p-3 rounded overflow-auto ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'}`}
        >
          {error.message || 'An unexpected error occurred'}
        </p>
        <button
          onClick={reset}
          class={`px-4 py-2 rounded font-medium ${isDark ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
        >
          Try Again
        </button>
        <p class={`text-xs mt-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          If this keeps happening, try refreshing the page
        </p>
      </div>
    </div>
  )
}

export function withErrorBoundary<P extends object>(
  WrappedComponent: ComponentType<P>,
  fallback?: FunctionalComponent<FallbackProps>,
): ComponentType<P> {
  return function WithErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    )
  }
}
