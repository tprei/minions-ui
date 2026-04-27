import type { DiffFile } from './diff-parse'
import { fileDisplayPath } from './diff-parse'

export interface FileTreeFileNode {
  kind: 'file'
  name: string
  path: string
  file: DiffFile
  index: number
}

export interface FileTreeDirNode {
  kind: 'dir'
  name: string
  path: string
  children: FileTreeNode[]
}

export type FileTreeNode = FileTreeDirNode | FileTreeFileNode

export function buildFileTree(files: DiffFile[]): FileTreeNode[] {
  const root: FileTreeDirNode = { kind: 'dir', name: '', path: '', children: [] }

  files.forEach((file, index) => {
    const path = fileDisplayPath(file)
    if (!path) return
    const segments = path.split('/').filter((s) => s.length > 0)
    if (segments.length === 0) return
    insertFile(root, segments, '', file, index)
  })

  collapseSingleChildDirs(root)
  sortNodes(root)
  return root.children
}

function insertFile(
  parent: FileTreeDirNode,
  segments: string[],
  parentPath: string,
  file: DiffFile,
  index: number,
): void {
  const [head, ...rest] = segments
  const segPath = parentPath ? `${parentPath}/${head}` : head
  if (rest.length === 0) {
    parent.children.push({ kind: 'file', name: head, path: segPath, file, index })
    return
  }
  let dir = parent.children.find(
    (c): c is FileTreeDirNode => c.kind === 'dir' && c.name === head,
  )
  if (!dir) {
    dir = { kind: 'dir', name: head, path: segPath, children: [] }
    parent.children.push(dir)
  }
  insertFile(dir, rest, segPath, file, index)
}

function collapseSingleChildDirs(node: FileTreeDirNode): void {
  for (const child of node.children) {
    if (child.kind === 'dir') collapseSingleChildDirs(child)
  }
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]
    if (
      child.kind === 'dir' &&
      child.children.length === 1 &&
      child.children[0].kind === 'dir'
    ) {
      const inner = child.children[0]
      const merged: FileTreeDirNode = {
        kind: 'dir',
        name: `${child.name}/${inner.name}`,
        path: inner.path,
        children: inner.children,
      }
      node.children[i] = merged
      i--
    }
  }
}

function sortNodes(node: FileTreeDirNode): void {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const child of node.children) {
    if (child.kind === 'dir') sortNodes(child)
  }
}

export function collectFileIndexes(nodes: FileTreeNode[]): number[] {
  const out: number[] = []
  const walk = (list: FileTreeNode[]) => {
    for (const n of list) {
      if (n.kind === 'file') out.push(n.index)
      else walk(n.children)
    }
  }
  walk(nodes)
  return out
}
