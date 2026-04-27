import { render, screen, fireEvent, waitFor } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FeedbackReasonPopup } from '../../../src/chat/transcript/FeedbackReasonPopup'

beforeEach(() => {
  vi.clearAllMocks()
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
  }
})

describe('FeedbackReasonPopup', () => {
  it('renders the popup with title and reason chips', () => {
    render(<FeedbackReasonPopup onSubmit={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByText('What went wrong?')).toBeTruthy()
    expect(screen.getByTestId('feedback-reason-incorrect')).toBeTruthy()
    expect(screen.getByTestId('feedback-reason-off_topic')).toBeTruthy()
    expect(screen.getByTestId('feedback-reason-too_verbose')).toBeTruthy()
    expect(screen.getByTestId('feedback-reason-unsafe')).toBeTruthy()
    expect(screen.getByTestId('feedback-reason-other')).toBeTruthy()
  })

  it('renders cancel and submit buttons', () => {
    render(<FeedbackReasonPopup onSubmit={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByTestId('feedback-cancel')).toBeTruthy()
    expect(screen.getByTestId('feedback-submit')).toBeTruthy()
  })

  it('shows submit button as disabled when no reason is selected', () => {
    render(<FeedbackReasonPopup onSubmit={vi.fn()} onCancel={vi.fn()} />)

    const submitBtn = screen.getByTestId('feedback-submit')
    expect(submitBtn.hasAttribute('disabled')).toBe(true)
  })

  it('enables submit button when a reason is selected', () => {
    render(<FeedbackReasonPopup onSubmit={vi.fn()} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByTestId('feedback-reason-incorrect'))

    const submitBtn = screen.getByTestId('feedback-submit')
    expect(submitBtn.hasAttribute('disabled')).toBe(false)
  })

  it('marks selected reason chip', () => {
    render(<FeedbackReasonPopup onSubmit={vi.fn()} onCancel={vi.fn()} />)

    const incorrectChip = screen.getByTestId('feedback-reason-incorrect')
    fireEvent.click(incorrectChip)

    expect(incorrectChip.getAttribute('data-selected')).toBe('true')
  })

  it('allows switching between reasons', () => {
    render(<FeedbackReasonPopup onSubmit={vi.fn()} onCancel={vi.fn()} />)

    const incorrectChip = screen.getByTestId('feedback-reason-incorrect')
    const verboseChip = screen.getByTestId('feedback-reason-too_verbose')

    fireEvent.click(incorrectChip)
    expect(incorrectChip.getAttribute('data-selected')).toBe('true')

    fireEvent.click(verboseChip)
    expect(incorrectChip.getAttribute('data-selected')).toBe('false')
    expect(verboseChip.getAttribute('data-selected')).toBe('true')
  })

  it('calls onSubmit with reason when submitted without comment', async () => {
    const onSubmit = vi.fn()
    render(<FeedbackReasonPopup onSubmit={onSubmit} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByTestId('feedback-reason-incorrect'))
    fireEvent.click(screen.getByTestId('feedback-submit'))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('incorrect', undefined)
    })
  })

  it('calls onSubmit with reason and comment when both provided', async () => {
    const onSubmit = vi.fn()
    render(<FeedbackReasonPopup onSubmit={onSubmit} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByTestId('feedback-reason-incorrect'))

    const commentArea = screen.getByTestId('feedback-comment') as HTMLTextAreaElement
    fireEvent.input(commentArea, { target: { value: 'The answer was wrong' } })

    fireEvent.click(screen.getByTestId('feedback-submit'))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('incorrect', 'The answer was wrong')
    })
  })

  it('trims whitespace from comment before submission', async () => {
    const onSubmit = vi.fn()
    render(<FeedbackReasonPopup onSubmit={onSubmit} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByTestId('feedback-reason-incorrect'))

    const commentArea = screen.getByTestId('feedback-comment') as HTMLTextAreaElement
    fireEvent.input(commentArea, { target: { value: '  whitespace test  ' } })

    fireEvent.click(screen.getByTestId('feedback-submit'))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('incorrect', 'whitespace test')
    })
  })

  it('does not submit comment if it is only whitespace', async () => {
    const onSubmit = vi.fn()
    render(<FeedbackReasonPopup onSubmit={onSubmit} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByTestId('feedback-reason-incorrect'))

    const commentArea = screen.getByTestId('feedback-comment') as HTMLTextAreaElement
    fireEvent.input(commentArea, { target: { value: '   ' } })

    fireEvent.click(screen.getByTestId('feedback-submit'))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('incorrect', undefined)
    })
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(<FeedbackReasonPopup onSubmit={vi.fn()} onCancel={onCancel} />)

    fireEvent.click(screen.getByTestId('feedback-cancel'))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when overlay is clicked', () => {
    const onCancel = vi.fn()
    const { container } = render(<FeedbackReasonPopup onSubmit={vi.fn()} onCancel={onCancel} />)

    const overlay = container.querySelector('.fixed > .absolute')
    if (overlay) {
      fireEvent.click(overlay)
    }

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('enforces maxLength of 2000 characters on comment', () => {
    render(<FeedbackReasonPopup onSubmit={vi.fn()} onCancel={vi.fn()} />)

    const commentArea = screen.getByTestId('feedback-comment') as HTMLTextAreaElement
    expect(commentArea.maxLength).toBe(2000)
  })

  it('shows character count for comment', () => {
    render(<FeedbackReasonPopup onSubmit={vi.fn()} onCancel={vi.fn()} />)

    const commentArea = screen.getByTestId('feedback-comment') as HTMLTextAreaElement
    fireEvent.input(commentArea, { target: { value: 'test' } })

    expect(screen.getByText('4 / 2000')).toBeTruthy()
  })

  it('disables all inputs and buttons when submitting', () => {
    render(<FeedbackReasonPopup onSubmit={vi.fn()} onCancel={vi.fn()} submitting={true} />)

    const incorrectChip = screen.getByTestId('feedback-reason-incorrect')
    const commentArea = screen.getByTestId('feedback-comment')
    const cancelBtn = screen.getByTestId('feedback-cancel')
    const submitBtn = screen.getByTestId('feedback-submit')

    expect(incorrectChip.hasAttribute('disabled')).toBe(true)
    expect(commentArea.hasAttribute('disabled')).toBe(true)
    expect(cancelBtn.hasAttribute('disabled')).toBe(true)
    expect(submitBtn.hasAttribute('disabled')).toBe(true)
  })

  it('shows "Submitting..." text on submit button when submitting', () => {
    render(<FeedbackReasonPopup onSubmit={vi.fn()} onCancel={vi.fn()} submitting={true} />)

    expect(screen.getByText('Submitting...')).toBeTruthy()
  })

  it('prevents form submission when no reason is selected', () => {
    const onSubmit = vi.fn()
    render(<FeedbackReasonPopup onSubmit={onSubmit} onCancel={vi.fn()} />)

    const form = screen.getByTestId('feedback-reason-popup').querySelector('form')
    if (form) {
      fireEvent.submit(form)
    }

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('displays all reason labels correctly', () => {
    render(<FeedbackReasonPopup onSubmit={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByText('Incorrect')).toBeTruthy()
    expect(screen.getByText("Didn't follow instructions")).toBeTruthy()
    expect(screen.getByText('Too verbose')).toBeTruthy()
    expect(screen.getByText('Unsafe / risky')).toBeTruthy()
    expect(screen.getByText('Other')).toBeTruthy()
  })
})
