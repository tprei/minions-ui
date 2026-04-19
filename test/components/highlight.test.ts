import { describe, it, expect } from 'vitest'
import { highlight, resolveLanguage } from '../../src/components/highlight'

describe('resolveLanguage', () => {
  it('maps common aliases', () => {
    expect(resolveLanguage('ts')).toBe('typescript')
    expect(resolveLanguage('tsx')).toBe('typescript')
    expect(resolveLanguage('py')).toBe('python')
    expect(resolveLanguage('sh')).toBe('bash')
    expect(resolveLanguage('yml')).toBe('yaml')
  })

  it('returns null for unknown or empty lang', () => {
    expect(resolveLanguage('')).toBe(null)
    expect(resolveLanguage(undefined)).toBe(null)
    expect(resolveLanguage('klingon')).toBe(null)
  })
})

describe('highlight', () => {
  it('escapes HTML when language is unknown', () => {
    const out = highlight('<script>alert(1)</script>', undefined)
    expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('tokenizes typescript keywords and strings', () => {
    const out = highlight('const x = "hello"', 'ts')
    expect(out).toContain('<span class="tok-keyword">const</span>')
    expect(out).toContain('<span class="tok-string">&quot;hello&quot;</span>')
  })

  it('tokenizes python comments and keywords', () => {
    const out = highlight('# hi\ndef foo():\n    return None', 'python')
    expect(out).toContain('<span class="tok-comment"># hi</span>')
    expect(out).toContain('<span class="tok-keyword">def</span>')
    expect(out).toContain('<span class="tok-keyword">return</span>')
    expect(out).toContain('<span class="tok-keyword">None</span>')
  })

  it('tokenizes json keys, strings, numbers and literals', () => {
    const out = highlight('{"ok": true, "n": 42, "s": "hi"}', 'json')
    expect(out).toContain('<span class="tok-keyword">true</span>')
    expect(out).toContain('<span class="tok-number">42</span>')
    expect(out).toContain('<span class="tok-string">&quot;hi&quot;</span>')
  })

  it('marks diff insertions and deletions line-by-line', () => {
    const out = highlight('- old\n+ new\n@@ hunk @@', 'diff')
    expect(out).toContain('<span class="tok-deletion">- old</span>')
    expect(out).toContain('<span class="tok-insertion">+ new</span>')
    expect(out).toContain('<span class="tok-hunk">@@ hunk @@</span>')
  })

  it('does not double-escape already-escaped content', () => {
    const out = highlight('"<b>"', 'json')
    expect(out).toContain('&lt;b&gt;')
    expect(out).not.toContain('&amp;lt;')
  })
})
