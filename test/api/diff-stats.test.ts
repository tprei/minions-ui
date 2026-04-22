import { describe, it, expect } from 'vitest'
import { computeDiffStats } from '../../src/api/diff-stats'

describe('computeDiffStats', () => {
  it('returns zero stats for empty patch', () => {
    expect(computeDiffStats('')).toEqual({
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
    })
  })

  it('counts single file with insertions and deletions', () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 unchanged line
-removed line
+added line
 another unchanged line`

    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 1,
      deletions: 1,
    })
  })

  it('counts multiple files', () => {
    const patch = `diff --git a/file1.txt b/file1.txt
--- a/file1.txt
+++ b/file1.txt
+new content
diff --git a/file2.txt b/file2.txt
--- a/file2.txt
+++ b/file2.txt
-old content`

    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 2,
      insertions: 1,
      deletions: 1,
    })
  })

  it('excludes file header lines from insertion/deletion counts', () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
+actual addition`

    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 1,
      deletions: 0,
    })
  })

  it('handles patch with only additions', () => {
    const patch = `diff --git a/new-file.txt b/new-file.txt
--- /dev/null
+++ b/new-file.txt
+first line
+second line
+third line`

    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 3,
      deletions: 0,
    })
  })

  it('handles patch with only deletions', () => {
    const patch = `diff --git a/old-file.txt b/old-file.txt
--- a/old-file.txt
+++ /dev/null
-first line
-second line
-third line`

    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 0,
      deletions: 3,
    })
  })

  it('handles patches with no diff hunks', () => {
    const patch = `diff --git a/binary.png b/binary.png
Binary files differ`

    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 0,
      deletions: 0,
    })
  })

  it('handles complex multi-file patch', () => {
    const patch = `diff --git a/src/api/client.ts b/src/api/client.ts
--- a/src/api/client.ts
+++ b/src/api/client.ts
@@ -10,6 +10,8 @@
 export interface ApiClient {
+  getVersion(): Promise<VersionInfo>
+  getSessions(): Promise<ApiSession[]>
-  getData(): Promise<any>
 }
diff --git a/src/api/types.ts b/src/api/types.ts
--- a/src/api/types.ts
+++ b/src/api/types.ts
@@ -1,2 +1,5 @@
+export interface VersionInfo {
+  version: string
+}
+
 export type ApiSession = {}`

    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 2,
      insertions: 6,
      deletions: 1,
    })
  })

  it('handles patch with context lines (not counted)', () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,5 +1,5 @@
 context line 1
 context line 2
-old line
+new line
 context line 4
 context line 5`

    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 1,
      deletions: 1,
    })
  })

  it('handles renamed files', () => {
    const patch = `diff --git a/old-name.txt b/new-name.txt
similarity index 95%
rename from old-name.txt
rename to new-name.txt
--- a/old-name.txt
+++ b/new-name.txt
@@ -1,3 +1,3 @@
 unchanged
-old content
+new content
 unchanged`

    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 1,
      deletions: 1,
    })
  })

  it('handles patch with no changes (rare but possible)', () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt`

    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 0,
      deletions: 0,
    })
  })

  it('handles patches with special characters in filenames', () => {
    const patch = `diff --git a/path/with spaces/file (1).txt b/path/with spaces/file (1).txt
--- a/path/with spaces/file (1).txt
+++ b/path/with spaces/file (1).txt
+content`

    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 1,
      deletions: 0,
    })
  })

  it('handles large patches efficiently', () => {
    const lines = ['diff --git a/large.txt b/large.txt', '--- a/large.txt', '+++ b/large.txt']
    for (let i = 0; i < 1000; i++) {
      lines.push('+new line ' + i)
    }
    for (let i = 0; i < 500; i++) {
      lines.push('-old line ' + i)
    }
    const patch = lines.join('\n')

    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 1000,
      deletions: 500,
    })
  })

  it('handles patches with +++ and --- in content', () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-+++ this is not a header
++--- this is content with dashes`

    expect(computeDiffStats(patch)).toEqual({
      filesChanged: 1,
      insertions: 1,
      deletions: 1,
    })
  })
})
