import { useEffect, useState } from 'preact/hooks'

export const ONBOARDING_TOUR_KEY = 'minions-ui:onboarding-tour:v1'

export interface TourStep {
  id: string
  icon: string
  title: string
  body: string
  hint?: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    icon: '👋',
    title: 'Welcome to minions',
    body: 'Minions are autonomous agents you can spawn from this UI. Each session represents one minion working on a task. Let’s take a quick tour of the surfaces.',
  },
  {
    id: 'new-task',
    icon: '✨',
    title: 'Start a new task',
    body: 'Type a task into the bar at the top to spawn a new minion. It runs autonomously until it ships a PR or asks for feedback.',
    hint: 'Try: "fix the failing CI test on main"',
  },
  {
    id: 'sessions',
    icon: '📋',
    title: 'Sessions list',
    body: 'Every running and recent minion shows up in the list on the left (or strip on top, on mobile). Tap a row to open its conversation.',
  },
  {
    id: 'long-press',
    icon: '🖐️',
    title: 'Long-press for actions',
    body: 'In Canvas view, long-press (mobile) or right-click (desktop) any node to open a context menu with stop, close, retry, and open-chat actions.',
  },
  {
    id: 'views',
    icon: '🎛️',
    title: 'Switch views',
    body: 'List shows a single session in detail. Canvas shows the full DAG of related minions. Ship walks each task through plan → implement → review → land stages.',
  },
  {
    id: 'ship',
    icon: '🚀',
    title: 'Ship pipeline',
    body: 'The Ship view groups your DAGs by stage so you can see what’s waiting on you, what’s in review, and what just landed. Failed nodes surface here first.',
  },
  {
    id: 'help',
    icon: '❓',
    title: 'Need a refresher?',
    body: 'Tap the ? button in the header any time to reopen this tour or browse the surface guide.',
  },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function OnboardingTour({ open, onClose }: Props) {
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    if (open) setStepIndex(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowRight') {
        setStepIndex((i) => Math.min(i + 1, TOUR_STEPS.length - 1))
      } else if (e.key === 'ArrowLeft') {
        setStepIndex((i) => Math.max(i - 1, 0))
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const step = TOUR_STEPS[stepIndex]
  const isFirst = stepIndex === 0
  const isLast = stepIndex === TOUR_STEPS.length - 1

  const handleNext = () => {
    if (isLast) {
      onClose()
    } else {
      setStepIndex(stepIndex + 1)
    }
  }

  const handleBack = () => {
    if (!isFirst) setStepIndex(stepIndex - 1)
  }

  return (
    <div
      class="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-tour-title"
      data-testid="onboarding-tour"
    >
      <div
        class="absolute inset-0 bg-black/50"
        onClick={onClose}
        data-testid="onboarding-tour-overlay"
      />
      <div
        class="relative w-full sm:max-w-md mx-0 sm:mx-4 mb-0 sm:mb-0 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl flex flex-col max-h-[85dvh]"
      >
        <div class="flex items-center justify-between px-5 pt-5 pb-2">
          <span
            class="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400"
            data-testid="onboarding-tour-step-counter"
          >
            Step {stepIndex + 1} of {TOUR_STEPS.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            class="rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-sm px-2 py-1"
            aria-label="Skip tour"
            data-testid="onboarding-tour-skip"
          >
            Skip
          </button>
        </div>
        <div class="px-5 pb-2 flex flex-col items-center text-center gap-3">
          <div
            class="text-4xl"
            aria-hidden="true"
            data-testid="onboarding-tour-icon"
          >
            {step.icon}
          </div>
          <h2
            id="onboarding-tour-title"
            class="text-lg font-semibold text-slate-900 dark:text-slate-100"
            data-testid="onboarding-tour-title"
          >
            {step.title}
          </h2>
          <p
            class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed"
            data-testid="onboarding-tour-body"
          >
            {step.body}
          </p>
          {step.hint && (
            <p
              class="text-xs text-slate-500 dark:text-slate-400 italic"
              data-testid="onboarding-tour-hint"
            >
              {step.hint}
            </p>
          )}
        </div>
        <div
          class="flex items-center justify-center gap-1.5 px-5 py-3"
          role="tablist"
          aria-label="Tour progress"
        >
          {TOUR_STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStepIndex(i)}
              role="tab"
              aria-selected={i === stepIndex}
              aria-label={`Go to step ${i + 1}: ${s.title}`}
              class={`h-1.5 rounded-full transition-all ${
                i === stepIndex
                  ? 'w-6 bg-indigo-600 dark:bg-indigo-400'
                  : 'w-1.5 bg-slate-300 dark:bg-slate-600 hover:bg-slate-400 dark:hover:bg-slate-500'
              }`}
              data-testid={`onboarding-tour-dot-${i}`}
            />
          ))}
        </div>
        <div class="flex items-center gap-2 px-5 pb-5 pt-1">
          <button
            type="button"
            onClick={handleBack}
            disabled={isFirst}
            class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
            data-testid="onboarding-tour-back"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleNext}
            class="ml-auto rounded-md bg-indigo-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-indigo-700 min-h-[44px]"
            data-testid="onboarding-tour-next"
          >
            {isLast ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function shouldShowFirstRunTour(hasConnections: boolean): boolean {
  if (!hasConnections) return false
  try {
    return localStorage.getItem(ONBOARDING_TOUR_KEY) !== 'completed'
  } catch {
    return false
  }
}

export function markTourCompleted(): void {
  try {
    localStorage.setItem(ONBOARDING_TOUR_KEY, 'completed')
  } catch {
    /* ignore */
  }
}

export function resetTour(): void {
  try {
    localStorage.removeItem(ONBOARDING_TOUR_KEY)
  } catch {
    /* ignore */
  }
}
