import { useState, useEffect } from 'preact/hooks'
import type { ConnectionStore } from '../../state/types'
import { hasFeature } from '../../api/features'
import type { FeedbackVote } from '../../api/types'
import { recordFeedback, useFeedbackStore } from '../../state/feedback-persist'
import { FeedbackReasonPopup } from './FeedbackReasonPopup'

interface Props {
  sessionId: string
  blockId: string
  store: ConnectionStore
  persisted?: boolean
}

export function FeedbackButtons({ sessionId, blockId, store, persisted }: Props) {
  if (!hasFeature(store, 'message-feedback')) return null

  const feedbackStore = useFeedbackStore(store.connectionId)
  const entryKey = `${sessionId}:${blockId}`
  const existing = feedbackStore.value[entryKey]

  const [submitting, setSubmitting] = useState(false)
  const [showReasonPopup, setShowReasonPopup] = useState(false)
  const [showThanks, setShowThanks] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (showThanks) {
      const timer = setTimeout(() => setShowThanks(false), 2000)
      return () => clearTimeout(timer)
    }
  }, [showThanks])

  async function handleVote(vote: FeedbackVote) {
    if (submitting) return
    if (vote === 'down') {
      setShowReasonPopup(true)
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const result = await store.client.submitFeedback({
        sessionId,
        messageBlockId: blockId,
        vote,
      })

      if (!result.success) {
        setError(result.error ?? 'Submission failed')
        return
      }

      await recordFeedback(store.connectionId, entryKey, {
        vote,
        ts: Date.now(),
      })

      setShowThanks(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReasonSubmit(reason: string, comment?: string) {
    setSubmitting(true)
    setError(null)

    try {
      const result = await store.client.submitFeedback({
        sessionId,
        messageBlockId: blockId,
        vote: 'down',
        reason: reason as 'incorrect' | 'off_topic' | 'too_verbose' | 'unsafe' | 'other',
        comment,
      })

      if (!result.success) {
        setError(result.error ?? 'Submission failed')
        return
      }

      await recordFeedback(store.connectionId, entryKey, {
        vote: 'down',
        reason,
        comment,
        ts: Date.now(),
      })

      setShowReasonPopup(false)
      setShowThanks(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const upSelected = existing?.vote === 'up'
  const downSelected = existing?.vote === 'down'

  if (showThanks) {
    return (
      <div
        class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-xs font-medium"
        data-testid="feedback-thanks"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
          <path
            fill-rule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
            clip-rule="evenodd"
          />
        </svg>
        Thanks!
      </div>
    )
  }

  return (
    <div class="relative">
      <div class="inline-flex items-center gap-1" data-testid="feedback-buttons">
        <button
          type="button"
          onClick={() => void handleVote('up')}
          disabled={submitting || persisted === false}
          aria-label="Thumbs up"
          data-testid="feedback-thumbs-up"
          data-selected={upSelected}
          class={`p-1 rounded transition-colors ${
            upSelected
              ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
              : 'text-slate-400 dark:text-slate-500 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
            <path d="M1 8.75a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-.75.75h-1.5A.75.75 0 0 1 1 15.25v-6.5ZM5 4.75a.75.75 0 0 1 .75-.75h1.19c.645 0 1.23.32 1.575.855l1.985 3.083V15.25a.75.75 0 0 1-.75.75H5.75a.75.75 0 0 1-.75-.75V4.75Z" />
            <path d="M11.25 8a.75.75 0 0 0-.75.75v5.5c0 .414.336.75.75.75h4.25a2.25 2.25 0 0 0 2.165-1.615l.82-2.95A3.75 3.75 0 0 0 15 6.25h-2.25a.75.75 0 0 1-.75-.75V3a.75.75 0 0 0-1.5 0v5Z" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => void handleVote('down')}
          disabled={submitting || persisted === false}
          aria-label="Thumbs down"
          data-testid="feedback-thumbs-down"
          data-selected={downSelected}
          class={`p-1 rounded transition-colors ${
            downSelected
              ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
              : 'text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 rotate-180">
            <path d="M1 8.75a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-.75.75h-1.5A.75.75 0 0 1 1 15.25v-6.5ZM5 4.75a.75.75 0 0 1 .75-.75h1.19c.645 0 1.23.32 1.575.855l1.985 3.083V15.25a.75.75 0 0 1-.75.75H5.75a.75.75 0 0 1-.75-.75V4.75Z" />
            <path d="M11.25 8a.75.75 0 0 0-.75.75v5.5c0 .414.336.75.75.75h4.25a2.25 2.25 0 0 0 2.165-1.615l.82-2.95A3.75 3.75 0 0 0 15 6.25h-2.25a.75.75 0 0 1-.75-.75V3a.75.75 0 0 0-1.5 0v5Z" />
          </svg>
        </button>
      </div>

      {error && (
        <div
          class="absolute top-full left-0 mt-1 px-2 py-1 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs whitespace-nowrap z-10"
          data-testid="feedback-error"
        >
          {error}
        </div>
      )}

      {showReasonPopup && (
        <FeedbackReasonPopup
          onSubmit={handleReasonSubmit}
          onCancel={() => setShowReasonPopup(false)}
          submitting={submitting}
        />
      )}
    </div>
  )
}
