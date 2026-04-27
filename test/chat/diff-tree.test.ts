import { describe, it, expect } from 'vitest'
import { buildFileTree, collectFileIndexes, type FileTreeDirNode, type FileTreeFileNode } from '../../src/chat/diff-tree'
import type { DiffFile } from '../../src/chat/diff-parse'

function makeFile(path: string, opts: Partial<DiffFile> = {}): DiffFile {
  return {
    oldPath: path,
    newPath: path,
    isNew: false,
    isDeleted: false,
    isRename: false,
    isBinary: false,
    hunks: [],
    ...opts,
  }
}

describe('buildFileTree', () => {
  it('returns empty tree for no files', () => {
    expect(buildFileTree([])).toEqual([])
  })

  it('places a single root-level file under no directory', () => {
    const tree = buildFileTree([makeFile('README.md')])
    expect(tree).toHaveLength(1)
    expect(tree[0].kind).toBe('file')
    expect(tree[0].name).toBe('README.md')
    expect(tree[0].path).toBe('README.md')
  })

  it('groups files into nested directories', () => {
    const files = [
      makeFile('src/chat/foo.ts'),
      makeFile('src/chat/bar.ts'),
      makeFile('src/api/client.ts'),
    ]
    const tree = buildFileTree(files)
    expect(tree).toHaveLength(1)
    const src = tree[0] as FileTreeDirNode
    expect(src.kind).toBe('dir')
    expect(src.name).toBe('src')
    expect(src.children.map((c) => c.name).sort()).toEqual(['api', 'chat'])
    const chat = src.children.find((c) => c.name === 'chat') as FileTreeDirNode
    expect(chat.children.map((c) => c.name)).toEqual(['bar.ts', 'foo.ts'])
  })

  it('collapses chains of single-child directories into one node', () => {
    const tree = buildFileTree([makeFile('a/b/c/file.ts')])
    expect(tree).toHaveLength(1)
    const dir = tree[0] as FileTreeDirNode
    expect(dir.kind).toBe('dir')
    expect(dir.name).toBe('a/b/c')
    expect(dir.children).toHaveLength(1)
    expect(dir.children[0].kind).toBe('file')
  })

  it('does not collapse a directory that has multiple children', () => {
    const files = [
      makeFile('a/b/x.ts'),
      makeFile('a/c/y.ts'),
    ]
    const tree = buildFileTree(files)
    expect(tree).toHaveLength(1)
    const a = tree[0] as FileTreeDirNode
    expect(a.name).toBe('a')
    expect(a.children).toHaveLength(2)
  })

  it('orders directories before files at each level', () => {
    const files = [
      makeFile('zzz.ts'),
      makeFile('aaa/inner.ts'),
    ]
    const tree = buildFileTree(files)
    expect(tree.map((n) => n.kind)).toEqual(['dir', 'file'])
  })

  it('preserves file index for tree-to-list mapping', () => {
    const files = [
      makeFile('src/a.ts'),
      makeFile('src/b.ts'),
      makeFile('top.md'),
    ]
    const tree = buildFileTree(files)
    const indexes = collectFileIndexes(tree).sort()
    expect(indexes).toEqual([0, 1, 2])
  })

  it('uses oldPath as the display name for deleted files', () => {
    const tree = buildFileTree([
      makeFile('removed/old.ts', { isDeleted: true, newPath: '' }),
    ])
    const dir = tree[0] as FileTreeDirNode
    expect(dir.name).toBe('removed')
    expect((dir.children[0] as FileTreeFileNode).name).toBe('old.ts')
  })
})

describe('collectFileIndexes', () => {
  it('walks tree depth-first and returns file indexes in tree order', () => {
    const files = [
      makeFile('src/a.ts'),
      makeFile('src/b.ts'),
      makeFile('lib/c.ts'),
    ]
    const tree = buildFileTree(files)
    const indexes = collectFileIndexes(tree)
    expect(indexes).toHaveLength(3)
    expect(indexes.sort()).toEqual([0, 1, 2])
  })
})
