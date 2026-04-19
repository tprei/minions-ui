import { describe, it, expect } from 'vitest'
import { parseUnifiedDiff, countChanges, fileDisplayPath } from '../../src/chat/diff-parse'

describe('parseUnifiedDiff', () => {
  it('returns empty array for empty patch', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })

  it('parses a single-file, single-hunk patch', () => {
    const patch = [
      'diff --git a/foo.ts b/foo.ts',
      'index 0000001..0000002 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' line1',
      '-line2',
      '+line2-new',
      '+line2b',
      ' line3',
    ].join('\n')
    const files = parseUnifiedDiff(patch)
    expect(files).toHaveLength(1)
    const f = files[0]
    expect(f.oldPath).toBe('foo.ts')
    expect(f.newPath).toBe('foo.ts')
    expect(f.hunks).toHaveLength(1)
    const h = f.hunks[0]
    expect(h.oldStart).toBe(1)
    expect(h.oldCount).toBe(3)
    expect(h.newStart).toBe(1)
    expect(h.newCount).toBe(4)
    expect(h.lines.map((l) => l.type)).toEqual(['context', 'del', 'add', 'add', 'context'])
    expect(h.lines[0]).toMatchObject({ type: 'context', text: 'line1', oldLineNo: 1, newLineNo: 1 })
    expect(h.lines[1]).toMatchObject({ type: 'del', text: 'line2', oldLineNo: 2 })
    expect(h.lines[2]).toMatchObject({ type: 'add', text: 'line2-new', newLineNo: 2 })
    expect(h.lines[3]).toMatchObject({ type: 'add', text: 'line2b', newLineNo: 3 })
    expect(h.lines[4]).toMatchObject({ type: 'context', text: 'line3', oldLineNo: 3, newLineNo: 4 })
  })

  it('parses multiple files with multiple hunks', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/b.ts b/b.ts',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -1,2 +1,2 @@',
      ' ctx',
      '-gone',
      '+added',
      '@@ -10,1 +10,2 @@',
      ' more',
      '+extra',
    ].join('\n')
    const files = parseUnifiedDiff(patch)
    expect(files).toHaveLength(2)
    expect(files[0].newPath).toBe('a.ts')
    expect(files[1].newPath).toBe('b.ts')
    expect(files[1].hunks).toHaveLength(2)
    expect(files[1].hunks[1].oldStart).toBe(10)
  })

  it('flags new and deleted files via /dev/null', () => {
    const patch = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,1 @@',
      '+hello',
      'diff --git a/del.ts b/del.ts',
      'deleted file mode 100644',
      '--- a/del.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-bye',
    ].join('\n')
    const files = parseUnifiedDiff(patch)
    expect(files).toHaveLength(2)
    expect(files[0].isNew).toBe(true)
    expect(files[0].newPath).toBe('new.ts')
    expect(files[1].isDeleted).toBe(true)
    expect(files[1].oldPath).toBe('del.ts')
  })

  it('marks renames and binary files', () => {
    const patch = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 95%',
      'rename from old.ts',
      'rename to new.ts',
      'diff --git a/img.png b/img.png',
      'index 111..222 100644',
      'Binary files a/img.png and b/img.png differ',
    ].join('\n')
    const files = parseUnifiedDiff(patch)
    expect(files).toHaveLength(2)
    expect(files[0].isRename).toBe(true)
    expect(files[0].oldPath).toBe('old.ts')
    expect(files[0].newPath).toBe('new.ts')
    expect(files[1].isBinary).toBe(true)
  })

  it('ignores "No newline at end of file" markers', () => {
    const patch = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1 +1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
    ].join('\n')
    const files = parseUnifiedDiff(patch)
    expect(files[0].hunks[0].lines.map((l) => l.type)).toEqual(['del', 'add'])
  })

  it('handles omitted counts in hunk headers (defaults to 1)', () => {
    const patch = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -5 +5 @@',
      '-a',
      '+b',
    ].join('\n')
    const files = parseUnifiedDiff(patch)
    expect(files[0].hunks[0].oldStart).toBe(5)
    expect(files[0].hunks[0].oldCount).toBe(1)
    expect(files[0].hunks[0].newCount).toBe(1)
  })

  it('skips prelude lines before the first file', () => {
    const patch = [
      '# some random prefix',
      '',
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n')
    const files = parseUnifiedDiff(patch)
    expect(files).toHaveLength(1)
  })
})

describe('countChanges', () => {
  it('counts insertions and deletions across hunks', () => {
    const patch = [
      'diff --git a/f b/f',
      '--- a/f',
      '+++ b/f',
      '@@ -1,3 +1,4 @@',
      ' a',
      '-b',
      '+c',
      '+d',
      ' e',
    ].join('\n')
    const [file] = parseUnifiedDiff(patch)
    expect(countChanges(file)).toEqual({ insertions: 2, deletions: 1 })
  })
})

describe('fileDisplayPath', () => {
  it('prefers new path; falls back to old path for deletes', () => {
    const patch = [
      'diff --git a/del.ts b/del.ts',
      'deleted file mode 100644',
      '--- a/del.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
    ].join('\n')
    const [f] = parseUnifiedDiff(patch)
    expect(fileDisplayPath(f)).toBe('del.ts')
  })
})
