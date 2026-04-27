import { useState } from 'preact/hooks'
import { useTheme } from '../../hooks/useTheme'
import type { FeedbackReason } from '../../api/types'

interface Props {
  onSubmit: (reason: string, comment?: string) => void | Promise<void>
  onCancel: () => void
  submitting?: boolean
}

const REASONS: Array<{ value: FeedbackReason; label: string }> = [
  { value: 'incorrect', label: 'Incorrect' },
  { value: 'off_topic', label: "Didn't follow instructions" },
  { value: 'too_verbose', label: 'Too verbose' },
  { value: 'unsafe', label: 'Unsafe / risky' },
  { value: 'other', label: 'Other' },
]

export function FeedbackReasonPopup({ onSubmit, onCancel, submitting }: Props) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const [selectedReason, setSelectedReason] = useState<FeedbackReason | null>(null)
  const [comment, setComment] = useState('')

  function handleSubmit(e: Event) {
    e.preventDefault()
    if (!selectedReason) return
    void onSubmit(selectedReason, comment.trim() || undefined)
  }

  const overlayBg = isDark ? 'bg-black/70' : 'bg-black/50'
  const popupBg = isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'
  const titleColor = isDark ? 'text-slate-100' : 'text-slate-900'
  const labelColor = isDark ? 'text-slate-300' : 'text-slate-700'
  const chipBg = isDark ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
  const chipSelectedBg = isDark ? 'bg-indigo-600 text-white' : 'bg-indigo-600 text-white'
  const textareaBg = isDark ? 'bg-slate-900 border-slate-600 text-slate-100' : 'bg-white border-slate-300 text-slate-900'
  const cancelColor = isDark ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-100'
  const submitBg = isDark ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center" data-testid="feedback-reason-popup">
      <div class={`absolute inset-0 ${overlayBg}`} onClick={onCancel} />
      <form
        onSubmit={handleSubmit}
        class={`relative ${popupBg} border rounded-lg shadow-xl p-4 max-w-sm w-full mx-4`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-reason-title"
      >
        <h3 id="feedback-reason-title" class={`text-sm font-semibold ${titleColor} mb-3`}>
          What went wrong?
        </h3>

        <div class="space-y-3">
          <div>
            <label class={`block text-xs font-medium ${labelColor} mb-2`}>
              Reason <span class="text-red-500">*</span>
            </label>
            <div class="flex flex-wrap gap-2">
              {REASONS.map((reason) => (
                <button
                  key={reason.value}
                  type="button"
                  onClick={() => setSelectedReason(reason.value)}
                  data-testid={`feedback-reason-${reason.value}`}
                  data-selected={selectedReason === reason.value}
                  class={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    selectedReason === reason.value ? chipSelectedBg : chipBg
                  }`}
                  disabled={submitting}
                >
                  {reason.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label class={`block text-xs font-medium ${labelColor} mb-1.5`} for="feedback-comment">
              Additional context <span class="text-slate-400">(optional)</span>
            </label>
            <textarea
              id="feedback-comment"
              value={comment}
              onInput={(e) => setComment((e.target as HTMLTextAreaElement).value)}
              maxLength={2000}
              rows={3}
              disabled={submitting}
              placeholder="Tell us more..."
              data-testid="feedback-comment"
              class={`w-full px-3 py-2 text-xs border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 ${textareaBg}`}
            />
            <div class="text-[10px] text-slate-400 dark:text-slate-500 mt-1 text-right">
              {comment.length} / 2000
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            data-testid="feedback-cancel"
            class={`px-3 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-50 ${cancelColor}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!selectedReason || submitting}
            data-testid="feedback-submit"
            class={`px-3 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${submitBg}`}
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </form>
    </div>
  )
}
