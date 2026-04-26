import { useEffect, useRef, useState } from 'preact/hooks'
import type { MemoryEntry, MemoryKind } from '../api/types'
import { useTheme } from '../hooks/useTheme'

interface Props {
  memory: MemoryEntry
  onSave: (updates: { title: string; body: string; pinned: boolean }) => void
  onCancel: () => void
}

const KIND_LABELS: Record<MemoryKind, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
}

export function MemoryEditor({ memory, onSave, onCancel }: Props) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const [title, setTitle] = useState(memory.title)
  const [body, setBody] = useState(memory.body)
  const [pinned, setPinned] = useState(memory.pinned)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleInputRef.current?.focus()
  }, [])

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    if (!title.trim() || !body.trim()) return
    onSave({ title: title.trim(), body: body.trim(), pinned })
  }

  const bgClass = isDark ? 'bg-gray-800' : 'bg-white'
  const borderClass = isDark ? 'border-gray-700' : 'border-gray-200'
  const inputBg = isDark ? 'bg-gray-700 text-white' : 'bg-white text-slate-900'
  const labelClass = isDark ? 'text-gray-300' : 'text-slate-700'

  return (
    <div
      class={`fixed inset-0 z-50 flex items-center justify-center p-4 ${isDark ? 'bg-black/70' : 'bg-black/50'}`}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      data-testid="memory-editor"
    >
      <div
        class={`w-full max-w-2xl rounded-lg shadow-2xl border ${borderClass} ${bgClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div class={`px-4 py-3 border-b ${borderClass}`}>
            <h2 class={`font-semibold text-lg ${isDark ? 'text-white' : 'text-slate-900'}`}>
              Edit Memory
            </h2>
            <p class={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
              Type: {KIND_LABELS[memory.kind]}
            </p>
          </div>

          <div class="p-4 space-y-4">
            <div>
              <label class={`block text-sm font-medium mb-1 ${labelClass}`}>Title</label>
              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                class={`w-full px-3 py-2 border ${borderClass} rounded-md text-sm ${inputBg} focus:outline-none focus:ring-2 focus:ring-indigo-500`}
                placeholder="Memory title"
                required
              />
            </div>

            <div>
              <label class={`block text-sm font-medium mb-1 ${labelClass}`}>Body</label>
              <textarea
                value={body}
                onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
                class={`w-full px-3 py-2 border ${borderClass} rounded-md text-sm ${inputBg} focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono`}
                rows={12}
                placeholder="Memory content"
                required
              />
            </div>

            <div class="flex items-center gap-2">
              <input
                type="checkbox"
                id="pinned"
                checked={pinned}
                onChange={(e) => setPinned((e.target as HTMLInputElement).checked)}
                class="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="pinned" class={`text-sm ${labelClass}`}>
                Pin this memory (always included in agent context)
              </label>
            </div>
          </div>

          <div class={`px-4 py-3 border-t ${borderClass} flex justify-end gap-2`}>
            <button
              type="button"
              onClick={onCancel}
              class={`px-4 py-2 rounded text-sm font-medium transition-colors ${isDark ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !body.trim()}
              class={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                !title.trim() || !body.trim()
                  ? isDark
                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : isDark
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
