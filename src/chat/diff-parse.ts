export type DiffLineType = 'context' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  text: string
  oldLineNo?: number
  newLineNo?: number
}

export interface DiffHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  oldPath: string
  newPath: string
  isNew: boolean
  isDeleted: boolean
  isRename: boolean
  isBinary: boolean
  hunks: DiffHunk[]
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

function stripPrefix(path: string): string {
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2)
  return path
}

export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = []
  if (!patch) return files
  const lines = patch.split('\n')
  let i = 0
  let current: DiffFile | null = null
  let currentHunk: DiffHunk | null = null
  let oldLineNo = 0
  let newLineNo = 0

  const pushFile = () => {
    if (current) {
      if (currentHunk) current.hunks.push(currentHunk)
      files.push(current)
    }
    current = null
    currentHunk = null
  }

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('diff --git ')) {
      pushFile()
      const match = line.match(/^diff --git (\S+) (\S+)$/)
      const oldP = match ? stripPrefix(match[1]) : ''
      const newP = match ? stripPrefix(match[2]) : ''
      current = {
        oldPath: oldP,
        newPath: newP,
        isNew: false,
        isDeleted: false,
        isRename: false,
        isBinary: false,
        hunks: [],
      }
      i++
      continue
    }

    if (!current) {
      if (line.startsWith('--- ') || line.startsWith('+++ ')) {
        current = {
          oldPath: '',
          newPath: '',
          isNew: false,
          isDeleted: false,
          isRename: false,
          isBinary: false,
          hunks: [],
        }
      } else {
        i++
        continue
      }
    }

    if (line.startsWith('new file mode')) {
      current.isNew = true
      i++
      continue
    }
    if (line.startsWith('deleted file mode')) {
      current.isDeleted = true
      i++
      continue
    }
    if (line.startsWith('rename from ') || line.startsWith('rename to ')) {
      current.isRename = true
      i++
      continue
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.isBinary = true
      i++
      continue
    }
    if (line.startsWith('index ') || line.startsWith('similarity index')) {
      i++
      continue
    }
    if (line.startsWith('--- ')) {
      const p = line.slice(4).trim()
      current.oldPath = p === '/dev/null' ? '' : stripPrefix(p)
      if (p === '/dev/null') current.isNew = true
      i++
      continue
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim()
      current.newPath = p === '/dev/null' ? '' : stripPrefix(p)
      if (p === '/dev/null') current.isDeleted = true
      i++
      continue
    }

    const hunkMatch = line.match(HUNK_HEADER_RE)
    if (hunkMatch) {
      if (currentHunk) current.hunks.push(currentHunk)
      const oldStart = parseInt(hunkMatch[1], 10)
      const oldCount = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1
      const newStart = parseInt(hunkMatch[3], 10)
      const newCount = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1
      currentHunk = {
        oldStart,
        oldCount,
        newStart,
        newCount,
        header: line,
        lines: [],
      }
      oldLineNo = oldStart
      newLineNo = newStart
      i++
      continue
    }

    if (currentHunk) {
      if (line.startsWith('\\')) {
        i++
        continue
      }
      const tag = line[0]
      const text = line.slice(1)
      if (tag === '+') {
        currentHunk.lines.push({ type: 'add', text, newLineNo })
        newLineNo++
      } else if (tag === '-') {
        currentHunk.lines.push({ type: 'del', text, oldLineNo })
        oldLineNo++
      } else if (tag === ' ' || line === '') {
        currentHunk.lines.push({ type: 'context', text, oldLineNo, newLineNo })
        oldLineNo++
        newLineNo++
      } else {
        i++
        continue
      }
    }
    i++
  }

  pushFile()
  return files
}

export interface DiffTotals {
  insertions: number
  deletions: number
}

export function countChanges(file: DiffFile): DiffTotals {
  let insertions = 0
  let deletions = 0
  for (const hunk of file.hunks) {
    for (const l of hunk.lines) {
      if (l.type === 'add') insertions++
      else if (l.type === 'del') deletions++
    }
  }
  return { insertions, deletions }
}

export function fileDisplayPath(file: DiffFile): string {
  if (file.isDeleted) return file.oldPath
  return file.newPath || file.oldPath
}
