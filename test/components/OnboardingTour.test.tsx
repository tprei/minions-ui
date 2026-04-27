import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import {
  OnboardingTour,
  ONBOARDING_TOUR_KEY,
  TOUR_STEPS,
  shouldShowFirstRunTour,
  markTourCompleted,
  resetTour,
} from '../../src/components/OnboardingTour'

describe('OnboardingTour', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('renders nothing when open=false', () => {
    const { container } = render(
      <OnboardingTour open={false} onClose={() => {}} />,
    )
    expect(container.querySelector('[data-testid="onboarding-tour"]')).toBeNull()
  })

  it('renders the first step when open=true', () => {
    render(<OnboardingTour open={true} onClose={() => {}} />)
    expect(screen.getByTestId('onboarding-tour')).toBeTruthy()
    expect(screen.getByTestId('onboarding-tour-title').textContent).toBe(
      TOUR_STEPS[0].title,
    )
    expect(screen.getByTestId('onboarding-tour-step-counter').textContent).toBe(
      `Step 1 of ${TOUR_STEPS.length}`,
    )
  })

  it('Back button is disabled on the first step', () => {
    render(<OnboardingTour open={true} onClose={() => {}} />)
    const back = screen.getByTestId('onboarding-tour-back') as HTMLButtonElement
    expect(back.disabled).toBe(true)
  })

  it('Next advances step by step and shows Got it on the last step', () => {
    const onClose = vi.fn()
    render(<OnboardingTour open={true} onClose={onClose} />)
    const next = screen.getByTestId('onboarding-tour-next')
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) {
      fireEvent.click(next)
    }
    expect(screen.getByTestId('onboarding-tour-title').textContent).toBe(
      TOUR_STEPS[TOUR_STEPS.length - 1].title,
    )
    expect(screen.getByTestId('onboarding-tour-next').textContent).toBe('Got it')
    fireEvent.click(screen.getByTestId('onboarding-tour-next'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Back returns to the previous step', () => {
    render(<OnboardingTour open={true} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('onboarding-tour-next'))
    expect(screen.getByTestId('onboarding-tour-title').textContent).toBe(
      TOUR_STEPS[1].title,
    )
    fireEvent.click(screen.getByTestId('onboarding-tour-back'))
    expect(screen.getByTestId('onboarding-tour-title').textContent).toBe(
      TOUR_STEPS[0].title,
    )
  })

  it('Skip button calls onClose', () => {
    const onClose = vi.fn()
    render(<OnboardingTour open={true} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('onboarding-tour-skip'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking the overlay calls onClose', () => {
    const onClose = vi.fn()
    render(<OnboardingTour open={true} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('onboarding-tour-overlay'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking a progress dot jumps directly to that step', () => {
    render(<OnboardingTour open={true} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('onboarding-tour-dot-3'))
    expect(screen.getByTestId('onboarding-tour-title').textContent).toBe(
      TOUR_STEPS[3].title,
    )
  })

  it('Escape key calls onClose', () => {
    const onClose = vi.fn()
    render(<OnboardingTour open={true} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ArrowRight advances and ArrowLeft returns', () => {
    render(<OnboardingTour open={true} onClose={() => {}} />)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(screen.getByTestId('onboarding-tour-title').textContent).toBe(
      TOUR_STEPS[1].title,
    )
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(screen.getByTestId('onboarding-tour-title').textContent).toBe(
      TOUR_STEPS[0].title,
    )
  })

  it('resets to step 0 when reopened', () => {
    const { rerender } = render(<OnboardingTour open={true} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('onboarding-tour-next'))
    fireEvent.click(screen.getByTestId('onboarding-tour-next'))
    rerender(<OnboardingTour open={false} onClose={() => {}} />)
    rerender(<OnboardingTour open={true} onClose={() => {}} />)
    expect(screen.getByTestId('onboarding-tour-title').textContent).toBe(
      TOUR_STEPS[0].title,
    )
  })
})

describe('OnboardingTour storage helpers', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('shouldShowFirstRunTour returns false when no connections exist', () => {
    expect(shouldShowFirstRunTour(false)).toBe(false)
  })

  it('shouldShowFirstRunTour returns true when connections exist and no completion flag', () => {
    expect(shouldShowFirstRunTour(true)).toBe(true)
  })

  it('shouldShowFirstRunTour returns false once completed', () => {
    markTourCompleted()
    expect(shouldShowFirstRunTour(true)).toBe(false)
    expect(localStorage.getItem(ONBOARDING_TOUR_KEY)).toBe('completed')
  })

  it('resetTour clears the completion flag so the tour is shown again', () => {
    markTourCompleted()
    expect(shouldShowFirstRunTour(true)).toBe(false)
    resetTour()
    expect(shouldShowFirstRunTour(true)).toBe(true)
    expect(localStorage.getItem(ONBOARDING_TOUR_KEY)).toBeNull()
  })
})
