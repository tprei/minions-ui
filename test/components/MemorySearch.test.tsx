import { render, screen, fireEvent } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signal } from '@preact/signals'

vi.mock('../../src/hooks/useTheme', () => ({
  useTheme: () => signal('light'),
}))

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  fireEvent.input(input)
}

describe('MemorySearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function setup(value = '', onSearch = vi.fn()) {
    const { MemorySearch } = await import('../../src/components/MemorySearch')
    render(<MemorySearch value={value} onSearch={onSearch} />)
    return { onSearch }
  }

  it('renders search input', async () => {
    await setup()
    expect(screen.getByTestId('memory-search-input')).toBeTruthy()
  })

  it('prefills input with value prop', async () => {
    await setup('test query')
    const input = screen.getByTestId('memory-search-input') as HTMLInputElement
    expect(input.value).toBe('test query')
  })

  it('calls onSearch with trimmed query on submit', async () => {
    const { onSearch } = await setup()
    const input = screen.getByTestId('memory-search-input') as HTMLInputElement
    setInputValue(input, '  test query  ')
    const form = input.closest('form')!
    fireEvent.submit(form)
    expect(onSearch).toHaveBeenCalledWith('test query')
  })

  it('shows clear button when query is not empty', async () => {
    await setup('test')
    expect(screen.getByTestId('clear-search')).toBeTruthy()
  })

  it('hides clear button when query is empty', async () => {
    await setup('')
    expect(screen.queryByTestId('clear-search')).toBeFalsy()
  })

  it('clears query and calls onSearch when clear button clicked', async () => {
    const { onSearch } = await setup('test')
    const clearBtn = screen.getByTestId('clear-search')
    fireEvent.click(clearBtn)
    const input = screen.getByTestId('memory-search-input') as HTMLInputElement
    expect(input.value).toBe('')
    expect(onSearch).toHaveBeenCalledWith('')
  })
})
