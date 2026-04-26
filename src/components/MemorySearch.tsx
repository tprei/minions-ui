import { useState } from 'preact/hooks'
import { useTheme } from '../hooks/useTheme'

interface Props {
  value: string
  onSearch: (query: string) => void
}

export function MemorySearch({ value, onSearch }: Props) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const [query, setQuery] = useState(value)

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    onSearch(query.trim())
  }

  const bgClass = isDark ? 'bg-gray-700 text-white' : 'bg-white text-slate-900'
  const borderClass = isDark ? 'border-gray-600' : 'border-gray-300'

  return (
    <form onSubmit={handleSubmit} class="w-full">
      <div class="relative">
        <input
          type="text"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          placeholder="Search memories..."
          class={`w-full pl-8 pr-3 py-2 border ${borderClass} rounded-md text-sm ${bgClass} focus:outline-none focus:ring-2 focus:ring-indigo-500`}
          data-testid="memory-search-input"
        />
        <span
          class={`absolute left-2.5 top-1/2 -translate-y-1/2 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
        >
          🔍
        </span>
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              onSearch('')
            }}
            class={`absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
            data-testid="clear-search"
          >
            ×
          </button>
        )}
      </div>
    </form>
  )
}
