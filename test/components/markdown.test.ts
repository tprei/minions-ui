import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/components/markdown'

describe('renderMarkdown', () => {
  it('renders bold and italic', () => {
    const out = renderMarkdown('hello **world** and *moon*')
    expect(out).toContain('<strong>world</strong>')
    expect(out).toContain('<em>moon</em>')
  })

  it('renders fenced code blocks', () => {
    const out = renderMarkdown('```\nconst x = 1\n```')
    expect(out).toContain('<pre>')
    expect(out).toContain('const x = 1')
  })

  it('wraps fenced code blocks with a copy-to-clipboard button', () => {
    const out = renderMarkdown('```\nconst x = 1\n```')
    expect(out).toContain('code-block-wrap')
    expect(out).toContain('data-copy')
    expect(out).toContain('aria-label="Copy code to clipboard"')
  })

  it('does not add a copy button to mermaid blocks', () => {
    const out = renderMarkdown('```mermaid\ngraph TD; A-->B\n```')
    expect(out).not.toContain('data-copy')
    expect(out).not.toContain('code-block-wrap')
  })

  it('applies syntax highlighting classes for fenced blocks with a known language', () => {
    const out = renderMarkdown('```ts\nconst x = 1\n```')
    expect(out).toContain('language-typescript')
    expect(out).toContain('tok-keyword')
    expect(out).toContain('tok-number')
  })

  it('preserves mermaid blocks without tokenization', () => {
    const out = renderMarkdown('```mermaid\ngraph TD; A-->B\n```')
    expect(out).toContain('language-mermaid')
    expect(out).not.toContain('tok-keyword')
  })

  it('strips <script> tags (XSS)', () => {
    const out = renderMarkdown('ok <script>alert(1)</script> still ok')
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('alert(1)')
  })

  it('strips unsafe attributes like onerror', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(out.toLowerCase()).not.toContain('onerror')
  })

  it('strips <img> tags — only explicitly allowed tags remain', () => {
    const out = renderMarkdown('![alt](http://example.com/x.png)')
    expect(out).not.toContain('<img')
  })

  it('preserves GFM tables', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    const out = renderMarkdown(md)
    expect(out).toContain('<table>')
    expect(out).toContain('<th>a</th>')
  })

  it('preserves anchor tags with href', () => {
    const out = renderMarkdown('[link](https://example.com)')
    expect(out).toContain('<a href="https://example.com">link</a>')
  })
})
