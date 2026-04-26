import type { MemoryEntry, MemoryKind, MemoryStatus } from '../api/types'
import { useTheme } from '../hooks/useTheme'
import { formatRelativeTime } from './shared'

interface Props {
  memory: MemoryEntry
  onEdit?: (memory: MemoryEntry) => void
  onApprove?: (id: number) => void
  onReject?: (id: number) => void
  onDelete?: (id: number) => void
  onViewSource?: (sessionId: string) => void
  showActions?: boolean
}

const KIND_LABELS: Record<MemoryKind, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
}

const STATUS_CONFIG: Record<
  MemoryStatus,
  { label: string; className: string; darkClassName: string }
> = {
  pending: {
    label: 'Pending',
    className: 'bg-yellow-100 text-yellow-700',
    darkClassName: 'bg-yellow-900/50 text-yellow-300',
  },
  approved: {
    label: 'Approved',
    className: 'bg-green-100 text-green-700',
    darkClassName: 'bg-green-900/50 text-green-300',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-red-100 text-red-700',
    darkClassName: 'bg-red-900/50 text-red-300',
  },
  superseded: {
    label: 'Superseded',
    className: 'bg-gray-100 text-gray-600',
    darkClassName: 'bg-gray-700 text-gray-400',
  },
  pending_deletion: {
    label: 'Pending Deletion',
    className: 'bg-orange-100 text-orange-700',
    darkClassName: 'bg-orange-900/50 text-orange-300',
  },
}

export function MemoryRow({
  memory,
  onEdit,
  onApprove,
  onReject,
  onDelete,
  onViewSource,
  showActions = false,
}: Props) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'

  const kindColor = isDark ? 'text-blue-400' : 'text-blue-600'
  const statusConfig = STATUS_CONFIG[memory.status]
  const statusClass = isDark ? statusConfig.darkClassName : statusConfig.className

  return (
    <div
      class={`p-3 border-b ${isDark ? 'border-gray-700 hover:bg-gray-700/50' : 'border-gray-200 hover:bg-gray-50'} transition-colors`}
      data-testid="memory-row"
    >
      <div class="flex items-start gap-2 mb-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class={`text-xs font-medium uppercase ${kindColor}`}>
              {KIND_LABELS[memory.kind]}
            </span>
            <span class={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}`}>
              {statusConfig.label}
            </span>
            {memory.pinned && (
              <span
                class={`text-xs ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}
                title="Pinned"
              >
                📌
              </span>
            )}
          </div>
          <h3
            class={`font-semibold text-sm mb-1 ${isDark ? 'text-white' : 'text-slate-900'} truncate`}
          >
            {memory.title}
          </h3>
          <p
            class={`text-xs ${isDark ? 'text-gray-300' : 'text-slate-700'} line-clamp-2 whitespace-pre-wrap`}
          >
            {memory.body}
          </p>
        </div>
      </div>

      <div class="flex items-center justify-between gap-2 text-xs">
        <div class={`flex items-center gap-2 ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
          <span>{formatRelativeTime(new Date(memory.createdAt).toISOString())}</span>
          {memory.sourceSessionId && onViewSource && (
            <>
              <span>•</span>
              <button
                onClick={() => onViewSource(memory.sourceSessionId!)}
                class={`underline ${isDark ? 'hover:text-gray-300' : 'hover:text-slate-700'}`}
              >
                View source
              </button>
            </>
          )}
        </div>

        {showActions && (
          <div class="flex items-center gap-1">
            {memory.status === 'pending' && (
              <>
                {onApprove && (
                  <button
                    onClick={() => onApprove(memory.id)}
                    class={`px-2 py-1 rounded text-xs font-medium transition-colors ${isDark ? 'bg-green-900/50 text-green-300 hover:bg-green-900' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                    data-testid="approve-button"
                  >
                    ✓ Approve
                  </button>
                )}
                {onReject && (
                  <button
                    onClick={() => onReject(memory.id)}
                    class={`px-2 py-1 rounded text-xs font-medium transition-colors ${isDark ? 'bg-red-900/50 text-red-300 hover:bg-red-900' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                    data-testid="reject-button"
                  >
                    ✗ Reject
                  </button>
                )}
                {onEdit && (
                  <button
                    onClick={() => onEdit(memory)}
                    class={`px-2 py-1 rounded text-xs font-medium transition-colors ${isDark ? 'bg-blue-900/50 text-blue-300 hover:bg-blue-900' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
                    data-testid="edit-button"
                  >
                    Edit
                  </button>
                )}
              </>
            )}
            {memory.status === 'approved' && onEdit && (
              <button
                onClick={() => onEdit(memory)}
                class={`px-2 py-1 rounded text-xs font-medium transition-colors ${isDark ? 'bg-blue-900/50 text-blue-300 hover:bg-blue-900' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
                data-testid="edit-button"
              >
                Edit
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(memory.id)}
                class={`px-2 py-1 rounded text-xs font-medium transition-colors ${isDark ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                data-testid="delete-button"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
