export type TokenType =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'builtin'
  | 'regex'

export interface SyntaxToken {
  type: TokenType
  text: string
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'ts',
  tsx: 'ts',
  mts: 'ts',
  cts: 'ts',
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  py: 'py',
  pyi: 'py',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  rb: 'ruby',
  php: 'php',
  cs: 'csharp',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  h: 'c',
  c: 'c',
  swift: 'swift',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
  fish: 'sh',
  sql: 'sql',
}

const TS_KEYWORDS = new Set([
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'debugger', 'declare', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'get', 'if',
  'implements', 'import', 'in', 'infer', 'instanceof', 'interface', 'is', 'keyof',
  'let', 'namespace', 'never', 'new', 'null', 'of', 'package', 'private',
  'protected', 'public', 'readonly', 'return', 'satisfies', 'set', 'static',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof',
  'undefined', 'var', 'void', 'while', 'with', 'yield',
])

const TS_BUILTINS = new Set([
  'Array', 'Boolean', 'Date', 'Error', 'Map', 'Math', 'Number', 'Object',
  'Promise', 'Record', 'RegExp', 'Set', 'String', 'Symbol', 'console',
  'document', 'globalThis', 'window',
])

const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for',
  'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'match', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
])

const PY_BUILTINS = new Set([
  'bool', 'bytes', 'dict', 'float', 'frozenset', 'int', 'list', 'object',
  'print', 'range', 'set', 'str', 'tuple', 'type', 'len', 'isinstance', 'self',
])

const GO_KEYWORDS = new Set([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
  'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
  'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type',
  'var', 'true', 'false', 'nil',
])

const GO_BUILTINS = new Set([
  'bool', 'byte', 'complex64', 'complex128', 'error', 'float32', 'float64',
  'int', 'int8', 'int16', 'int32', 'int64', 'rune', 'string', 'uint', 'uint8',
  'uint16', 'uint32', 'uint64', 'uintptr', 'make', 'new', 'len', 'cap',
  'append', 'copy', 'close', 'panic', 'recover', 'print', 'println',
])

const RUST_KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else',
  'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop',
  'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'Self', 'self',
  'static', 'struct', 'super', 'trait', 'true', 'type', 'union', 'unsafe',
  'use', 'where', 'while',
])

const RUST_BUILTINS = new Set([
  'bool', 'char', 'f32', 'f64', 'i8', 'i16', 'i32', 'i64', 'i128', 'isize',
  'str', 'u8', 'u16', 'u32', 'u64', 'u128', 'usize', 'String', 'Vec', 'Option',
  'Result', 'Some', 'None', 'Ok', 'Err', 'Box',
])

const SH_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while',
  'until', 'case', 'esac', 'function', 'return', 'break', 'continue', 'local',
  'export', 'readonly', 'declare', 'source',
])

const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'group', 'by', 'order', 'limit', 'offset', 'join',
  'left', 'right', 'inner', 'outer', 'on', 'as', 'and', 'or', 'not', 'in',
  'is', 'null', 'true', 'false', 'insert', 'into', 'values', 'update', 'set',
  'delete', 'create', 'table', 'drop', 'alter', 'index', 'with', 'returning',
  'distinct', 'union', 'case', 'when', 'then', 'else', 'end', 'having',
])

const JSON_KEYWORDS = new Set(['true', 'false', 'null'])

const JAVA_C_KEYWORDS = new Set([
  'abstract', 'assert', 'auto', 'boolean', 'break', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
  'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'null',
  'package', 'private', 'protected', 'public', 'return', 'short', 'static',
  'struct', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
  'transient', 'true', 'false', 'try', 'void', 'volatile', 'while', 'namespace',
  'template', 'typename', 'typedef', 'union', 'using', 'virtual',
])

interface LangSpec {
  keywords: Set<string>
  builtins?: Set<string>
  line?: string[]
  block?: [string, string]
  strings: string[]
  identifierStart?: RegExp
  identifierPart?: RegExp
}

const DEFAULT_ID_START = /[a-zA-Z_$]/
const DEFAULT_ID_PART = /[a-zA-Z0-9_$]/

const LANGS: Record<string, LangSpec> = {
  ts: {
    keywords: TS_KEYWORDS,
    builtins: TS_BUILTINS,
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"', "'", '`'],
  },
  js: {
    keywords: TS_KEYWORDS,
    builtins: TS_BUILTINS,
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"', "'", '`'],
  },
  py: {
    keywords: PY_KEYWORDS,
    builtins: PY_BUILTINS,
    line: ['#'],
    strings: ['"', "'"],
  },
  go: {
    keywords: GO_KEYWORDS,
    builtins: GO_BUILTINS,
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"', '`'],
  },
  rust: {
    keywords: RUST_KEYWORDS,
    builtins: RUST_BUILTINS,
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"'],
  },
  java: {
    keywords: JAVA_C_KEYWORDS,
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"', "'"],
  },
  kotlin: {
    keywords: JAVA_C_KEYWORDS,
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"', "'"],
  },
  csharp: {
    keywords: JAVA_C_KEYWORDS,
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"', "'"],
  },
  cpp: {
    keywords: JAVA_C_KEYWORDS,
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"', "'"],
  },
  c: {
    keywords: JAVA_C_KEYWORDS,
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"', "'"],
  },
  swift: {
    keywords: JAVA_C_KEYWORDS,
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"'],
  },
  ruby: {
    keywords: new Set([
      'BEGIN', 'END', 'alias', 'and', 'begin', 'break', 'case', 'class', 'def',
      'defined?', 'do', 'else', 'elsif', 'end', 'ensure', 'false', 'for', 'if',
      'in', 'module', 'next', 'nil', 'not', 'or', 'redo', 'rescue', 'retry',
      'return', 'self', 'super', 'then', 'true', 'undef', 'unless', 'until',
      'when', 'while', 'yield',
    ]),
    line: ['#'],
    strings: ['"', "'"],
  },
  php: {
    keywords: new Set([
      'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch',
      'class', 'clone', 'const', 'continue', 'declare', 'default', 'do', 'echo',
      'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach', 'endif',
      'endswitch', 'endwhile', 'extends', 'final', 'finally', 'for', 'foreach',
      'function', 'global', 'goto', 'if', 'implements', 'include', 'instanceof',
      'interface', 'isset', 'list', 'namespace', 'new', 'null', 'or', 'print',
      'private', 'protected', 'public', 'require', 'return', 'static', 'switch',
      'throw', 'trait', 'try', 'unset', 'use', 'var', 'while', 'xor', 'yield',
      'true', 'false',
    ]),
    line: ['//', '#'],
    block: ['/*', '*/'],
    strings: ['"', "'"],
  },
  sh: {
    keywords: SH_KEYWORDS,
    line: ['#'],
    strings: ['"', "'"],
  },
  sql: {
    keywords: SQL_KEYWORDS,
    line: ['--'],
    block: ['/*', '*/'],
    strings: ['"', "'"],
  },
  json: {
    keywords: JSON_KEYWORDS,
    strings: ['"'],
  },
  css: {
    keywords: new Set([]),
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"', "'"],
  },
}

export function detectLanguage(path: string): string | null {
  if (!path) return null
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/)
  if (!match) return null
  return EXT_TO_LANG[match[1]] ?? null
}

export function highlightLine(text: string, lang: string | null): SyntaxToken[] {
  if (!lang) return [{ type: 'plain', text }]
  const spec = LANGS[lang]
  if (!spec) return [{ type: 'plain', text }]

  const tokens: SyntaxToken[] = []
  const idStart = spec.identifierStart ?? DEFAULT_ID_START
  const idPart = spec.identifierPart ?? DEFAULT_ID_PART
  const n = text.length
  let i = 0

  const push = (type: TokenType, s: string) => {
    if (!s) return
    const last = tokens[tokens.length - 1]
    if (last && last.type === type) last.text += s
    else tokens.push({ type, text: s })
  }

  while (i < n) {
    if (spec.line) {
      let matched = false
      for (const prefix of spec.line) {
        if (text.startsWith(prefix, i)) {
          push('comment', text.slice(i))
          i = n
          matched = true
          break
        }
      }
      if (matched) break
    }

    if (spec.block && text.startsWith(spec.block[0], i)) {
      const endIdx = text.indexOf(spec.block[1], i + spec.block[0].length)
      if (endIdx >= 0) {
        const end = endIdx + spec.block[1].length
        push('comment', text.slice(i, end))
        i = end
      } else {
        push('comment', text.slice(i))
        i = n
      }
      continue
    }

    const c = text[i]

    if (spec.strings.includes(c)) {
      const quote = c
      let j = i + 1
      while (j < n) {
        if (text[j] === '\\' && j + 1 < n) {
          j += 2
          continue
        }
        if (text[j] === quote) {
          j++
          break
        }
        j++
      }
      push('string', text.slice(i, j))
      i = j
      continue
    }

    if (c >= '0' && c <= '9') {
      let j = i + 1
      if ((text[j] === 'x' || text[j] === 'X') && c === '0') {
        j++
        while (j < n && /[0-9a-fA-F_]/.test(text[j])) j++
      } else {
        while (j < n && /[0-9._]/.test(text[j])) j++
        if (text[j] === 'e' || text[j] === 'E') {
          j++
          if (text[j] === '+' || text[j] === '-') j++
          while (j < n && /[0-9_]/.test(text[j])) j++
        }
      }
      push('number', text.slice(i, j))
      i = j
      continue
    }

    if (idStart.test(c)) {
      let j = i + 1
      while (j < n && idPart.test(text[j])) j++
      const word = text.slice(i, j)
      const lowerForKw = lang === 'sql' ? word.toLowerCase() : word
      if (spec.keywords.has(lowerForKw)) push('keyword', word)
      else if (spec.builtins?.has(word)) push('builtin', word)
      else push('plain', word)
      i = j
      continue
    }

    push('plain', c)
    i++
  }

  return tokens
}

export function tokenClass(type: TokenType): string {
  switch (type) {
    case 'keyword':
      return 'text-violet-700 dark:text-violet-300'
    case 'string':
      return 'text-amber-700 dark:text-amber-300'
    case 'comment':
      return 'italic text-slate-500 dark:text-slate-400'
    case 'number':
      return 'text-teal-700 dark:text-teal-300'
    case 'builtin':
      return 'text-sky-700 dark:text-sky-300'
    case 'regex':
      return 'text-rose-700 dark:text-rose-300'
    default:
      return ''
  }
}
