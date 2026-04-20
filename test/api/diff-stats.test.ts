import { describe, it, expect } from 'vitest'
import { computeDiffStats } from '../../src/api/diff-stats'

describe('computeDiffStats', () => {
  it('returns zeros for an empty patch', () => {
    expect(computeDiffStats('')).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 })
  })

  it('counts a single-file diff with mixed insertions and deletions', () => {
    const patch = [
      'diff --git a/foo.ts b/foo.ts',
      'index 0000001..0000002 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' unchanged',
      '-removed',
      '+added-one',
      '+added-two',
      ' trailing',
    ].join('\n')
    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 2,
      deletions: 1,
    })
  })

  it('counts files across multiple diff --git headers', () => {
    const patch = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1,1 +1,4 @@',
      '-old',
      '+a',
      '+b',
      '+c',
      '+d',
      'diff --git a/y b/y',
      '--- a/y',
      '+++ b/y',
      '@@ -0,0 +1,1 @@',
      '+e',
      '',
    ].join('\n')
    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 2,
      insertions: 5,
      deletions: 1,
    })
  })

  it('ignores the +++ and --- per-file header lines', () => {
    const patch = [
      'diff --git a/foo b/foo',
      '--- a/foo',
      '+++ b/foo',
      '@@ -1,0 +1,1 @@',
      '+only-real-insertion',
    ].join('\n')
    const stats = computeDiffStats(patch)
    expect(stats.filesChanged).toBe(1)
    expect(stats.insertions).toBe(1)
    expect(stats.deletions).toBe(0)
  })

  it('handles a new-file diff (all insertions)', () => {
    const patch = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      'index 0000000..abcdef1',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,3 @@',
      '+line-1',
      '+line-2',
      '+line-3',
    ].join('\n')
    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 3,
      deletions: 0,
    })
  })

  it('handles a deleted-file diff (all deletions)', () => {
    const patch = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-bye-1',
      '-bye-2',
    ].join('\n')
    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 0,
      deletions: 2,
    })
  })

  it('does not count context or hunk-header lines', () => {
    const patch = [
      'diff --git a/a b/a',
      '--- a/a',
      '+++ b/a',
      '@@ -1,5 +1,5 @@',
      ' ctx-1',
      ' ctx-2',
      ' ctx-3',
      ' ctx-4',
      ' ctx-5',
    ].join('\n')
    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 0,
      deletions: 0,
    })
  })
})
