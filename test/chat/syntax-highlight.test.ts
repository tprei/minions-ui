import { describe, it, expect } from 'vitest'
import {
  detectLanguage,
  highlightLine,
  tokenClass,
} from '../../src/chat/syntax-highlight'

describe('detectLanguage', () => {
  it('maps common extensions', () => {
    expect(detectLanguage('src/foo.ts')).toBe('ts')
    expect(detectLanguage('src/foo.tsx')).toBe('ts')
    expect(detectLanguage('foo.js')).toBe('js')
    expect(detectLanguage('foo.py')).toBe('py')
    expect(detectLanguage('foo.go')).toBe('go')
    expect(detectLanguage('foo.rs')).toBe('rust')
    expect(detectLanguage('package.json')).toBe('json')
    expect(detectLanguage('styles.css')).toBe('css')
    expect(detectLanguage('run.sh')).toBe('sh')
  })

  it('returns null for unknown or empty paths', () => {
    expect(detectLanguage('')).toBeNull()
    expect(detectLanguage('Makefile')).toBeNull()
    expect(detectLanguage('foo.xyz')).toBeNull()
  })
})

describe('highlightLine', () => {
  const types = (text: string, lang: string | null) =>
    highlightLine(text, lang).map((t) => t.type)
  const byType = (text: string, lang: string | null, type: string) =>
    highlightLine(text, lang)
      .filter((t) => t.type === type)
      .map((t) => t.text)

  it('returns plain when lang is null', () => {
    const out = highlightLine('const x = 1', null)
    expect(out).toEqual([{ type: 'plain', text: 'const x = 1' }])
  })

  it('tags TS keywords, strings, and numbers', () => {
    const text = 'const x: number = 42'
    expect(byType(text, 'ts', 'keyword')).toContain('const')
    expect(byType(text, 'ts', 'number')).toContain('42')
  })

  it('tags TS strings', () => {
    expect(byType('const s = "hi"', 'ts', 'string')).toEqual(['"hi"'])
    expect(byType("const s = 'hi'", 'ts', 'string')).toEqual(["'hi'"])
    expect(byType('const s = `hi`', 'ts', 'string')).toEqual(['`hi`'])
  })

  it('handles line comments', () => {
    expect(byType('// comment', 'ts', 'comment')).toEqual(['// comment'])
    expect(byType('x = 1 # py comment', 'py', 'comment')).toEqual(['# py comment'])
  })

  it('handles block comments on a single line', () => {
    expect(byType('/* block */ x', 'ts', 'comment')).toEqual(['/* block */'])
  })

  it('handles unterminated block comments', () => {
    expect(byType('/* open', 'ts', 'comment')).toEqual(['/* open'])
  })

  it('does not treat keywords as substrings of identifiers', () => {
    const out = highlightLine('constant x = 1', 'ts')
    const kws = out.filter((t) => t.type === 'keyword').map((t) => t.text)
    expect(kws).not.toContain('const')
  })

  it('tags TS builtins separately', () => {
    expect(byType('Array.from()', 'ts', 'builtin')).toContain('Array')
  })

  it('tags hex numbers', () => {
    expect(byType('const n = 0xff', 'ts', 'number')).toEqual(['0xff'])
  })

  it('tags Python keywords and booleans', () => {
    const text = 'def foo(): return True'
    const kws = byType(text, 'py', 'keyword')
    expect(kws).toEqual(expect.arrayContaining(['def', 'return', 'True']))
  })

  it('tags Go keywords and builtins', () => {
    const text = 'func foo() int { return 0 }'
    expect(byType(text, 'go', 'keyword')).toEqual(expect.arrayContaining(['func', 'return']))
    expect(byType(text, 'go', 'builtin')).toContain('int')
  })

  it('tags Rust keywords and builtins', () => {
    const text = 'fn foo() -> String { }'
    expect(byType(text, 'rust', 'keyword')).toContain('fn')
    expect(byType(text, 'rust', 'builtin')).toContain('String')
  })

  it('tags SQL keywords case-insensitively', () => {
    expect(byType('SELECT id FROM t', 'sql', 'keyword')).toEqual(
      expect.arrayContaining(['SELECT', 'FROM']),
    )
  })

  it('tags JSON literals', () => {
    const text = '{"x": true, "y": null, "n": 1.5}'
    expect(byType(text, 'json', 'keyword')).toEqual(expect.arrayContaining(['true', 'null']))
    expect(byType(text, 'json', 'string')).toEqual(expect.arrayContaining(['"x"', '"y"', '"n"']))
    expect(byType(text, 'json', 'number')).toContain('1.5')
  })

  it('handles escaped quotes inside strings', () => {
    const out = highlightLine('"a\\"b"', 'ts')
    expect(out).toEqual([{ type: 'string', text: '"a\\"b"' }])
  })

  it('returns empty tokens array for empty text', () => {
    expect(highlightLine('', 'ts')).toEqual([])
  })

  it('returns plain when lang is unknown', () => {
    expect(types('anything', 'cobol')).toEqual(['plain'])
  })
})

describe('tokenClass', () => {
  it('maps token types to classnames', () => {
    expect(tokenClass('keyword')).toContain('violet')
    expect(tokenClass('string')).toContain('amber')
    expect(tokenClass('comment')).toContain('italic')
    expect(tokenClass('number')).toContain('teal')
    expect(tokenClass('builtin')).toContain('sky')
    expect(tokenClass('plain')).toBe('')
  })
})
