import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/preact'
import { MarkdownView } from '../../src/components/MarkdownView'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MarkdownView copy button', () => {
  it('renders a Copy button on a fenced code block', () => {
    render(<MarkdownView source={'```\nconst x = 1\n```'} />)
    const btn = screen.getByRole('button', { name: /copy code to clipboard/i })
    expect(btn).toBeTruthy()
    expect(btn.textContent).toBe('Copy')
  })

  it('writes the code content to the clipboard and shows a Copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<MarkdownView source={'```ts\nconst x = 1\n```'} />)
    const btn = screen.getByRole('button', { name: /copy code to clipboard/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1)
    })
    const [copied] = writeText.mock.calls[0]
    expect(copied).toContain('const x = 1')
    await waitFor(() => {
      expect(btn.textContent).toBe('Copied')
    })
  })

  it('shows a Failed state when the clipboard write rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<MarkdownView source={'```\nhello\n```'} />)
    const btn = screen.getByRole('button', { name: /copy code to clipboard/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(btn.textContent).toBe('Failed')
    })
  })
})
