export type TokenKind =
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'builtin'
  | 'regex'
  | 'operator'
  | 'punctuation'
  | 'tag'
  | 'attr'
  | 'property'
  | 'insertion'
  | 'deletion'
  | 'hunk'

interface Rule {
  kind: TokenKind
  re: RegExp
}

interface Language {
  rules: Rule[]
}

const ALIASES: Record<string, string> = {
  js: 'javascript',
  javascript: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'typescript',
  py: 'python',
  python: 'python',
  sh: 'bash',
  shell: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  css: 'css',
  html: 'html',
  xml: 'html',
  diff: 'diff',
  patch: 'diff',
  go: 'go',
  rust: 'rust',
  rs: 'rust',
  sql: 'sql',
  md: 'markdown',
  markdown: 'markdown',
}

function kw(words: string[]): RegExp {
  return new RegExp(`\\b(?:${words.join('|')})\\b`)
}

const JS_KEYWORDS = [
  'const', 'let', 'var', 'function', 'class', 'if', 'else', 'for', 'while',
  'return', 'export', 'import', 'from', 'as', 'default', 'new', 'this',
  'super', 'extends', 'implements', 'interface', 'type', 'enum', 'null',
  'undefined', 'true', 'false', 'async', 'await', 'try', 'catch', 'finally',
  'throw', 'break', 'continue', 'switch', 'case', 'do', 'in', 'of', 'typeof',
  'instanceof', 'void', 'yield', 'static', 'public', 'private', 'protected',
  'readonly', 'abstract', 'declare', 'namespace', 'satisfies', 'keyof',
]

const JS_BUILTINS = [
  'console', 'document', 'window', 'process', 'require', 'module', 'exports',
  'JSON', 'Math', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Promise',
  'Error', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp', 'Date',
  'Buffer', 'globalThis',
]

const jsLike: Language = {
  rules: [
    { kind: 'comment', re: /\/\/[^\n]*/ },
    { kind: 'comment', re: /\/\*[\s\S]*?\*\// },
    { kind: 'string', re: /`(?:\\.|\$\{[^}]*\}|[^`\\])*`/ },
    { kind: 'string', re: /"(?:\\.|[^"\\\n])*"/ },
    { kind: 'string', re: /'(?:\\.|[^'\\\n])*'/ },
    { kind: 'number', re: /\b(?:0x[\da-fA-F]+|0b[01]+|0o[0-7]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?n?)\b/ },
    { kind: 'keyword', re: kw(JS_KEYWORDS) },
    { kind: 'builtin', re: kw(JS_BUILTINS) },
    { kind: 'operator', re: /[+\-*/%=<>!&|^~?]+|=>/ },
    { kind: 'punctuation', re: /[{}[\]();,.:]/ },
  ],
}

const PYTHON_KEYWORDS = [
  'def', 'class', 'if', 'elif', 'else', 'for', 'while', 'return', 'import',
  'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'in', 'is',
  'not', 'and', 'or', 'None', 'True', 'False', 'lambda', 'yield', 'pass',
  'break', 'continue', 'global', 'nonlocal', 'async', 'await', 'del',
  'assert',
]

const PYTHON_BUILTINS = [
  'print', 'len', 'range', 'list', 'dict', 'set', 'tuple', 'str', 'int',
  'float', 'bool', 'type', 'isinstance', 'getattr', 'setattr', 'hasattr',
  'super', 'self', 'cls', 'open', 'input', 'map', 'filter', 'zip', 'enumerate',
  'sorted', 'reversed', 'abs', 'min', 'max', 'sum', 'any', 'all',
]

const python: Language = {
  rules: [
    { kind: 'comment', re: /#[^\n]*/ },
    { kind: 'string', re: /[rRbBuUfF]*'''[\s\S]*?'''/ },
    { kind: 'string', re: /[rRbBuUfF]*"""[\s\S]*?"""/ },
    { kind: 'string', re: /[rRbBuUfF]*"(?:\\.|[^"\\\n])*"/ },
    { kind: 'string', re: /[rRbBuUfF]*'(?:\\.|[^'\\\n])*'/ },
    { kind: 'number', re: /\b(?:0x[\da-fA-F]+|0b[01]+|0o[0-7]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?j?)\b/ },
    { kind: 'keyword', re: kw(PYTHON_KEYWORDS) },
    { kind: 'builtin', re: kw(PYTHON_BUILTINS) },
    { kind: 'operator', re: /[+\-*/%=<>!&|^~]+/ },
    { kind: 'punctuation', re: /[{}[\]();,.:]/ },
  ],
}

const BASH_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case',
  'esac', 'in', 'function', 'return', 'export', 'local', 'source', 'alias',
  'unset', 'set',
]

const BASH_BUILTINS = [
  'echo', 'cd', 'ls', 'grep', 'cat', 'mkdir', 'rm', 'cp', 'mv', 'pwd', 'touch',
  'sed', 'awk', 'curl', 'wget', 'npm', 'yarn', 'pnpm', 'git', 'docker',
  'kubectl', 'python', 'python3', 'node', 'bash', 'sh', 'make', 'head', 'tail',
  'find', 'xargs', 'chmod', 'chown', 'tar', 'zip', 'unzip',
]

const bash: Language = {
  rules: [
    { kind: 'comment', re: /#[^\n]*/ },
    { kind: 'string', re: /"(?:\\.|[^"\\])*"/ },
    { kind: 'string', re: /'[^']*'/ },
    { kind: 'number', re: /\b\d+\b/ },
    { kind: 'builtin', re: /\$[A-Za-z_][\w]*|\$\{[^}]+\}|\$\(\(?[^)]*\)?\)/ },
    { kind: 'keyword', re: kw(BASH_KEYWORDS) },
    { kind: 'builtin', re: kw(BASH_BUILTINS) },
    { kind: 'operator', re: /[|&;<>]+/ },
    { kind: 'operator', re: /--?[A-Za-z][\w-]*/ },
  ],
}

const json: Language = {
  rules: [
    { kind: 'property', re: /"(?:\\.|[^"\\])*"(?=\s*:)/ },
    { kind: 'string', re: /"(?:\\.|[^"\\])*"/ },
    { kind: 'number', re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/ },
    { kind: 'keyword', re: /\b(?:true|false|null)\b/ },
    { kind: 'punctuation', re: /[{}[\],:]/ },
  ],
}

const yaml: Language = {
  rules: [
    { kind: 'comment', re: /#[^\n]*/ },
    { kind: 'property', re: /^[\t ]*[A-Za-z_][\w-]*(?=:)/m },
    { kind: 'string', re: /"(?:\\.|[^"\\])*"/ },
    { kind: 'string', re: /'(?:[^']|'')*'/ },
    { kind: 'number', re: /\b-?\d+(?:\.\d+)?\b/ },
    { kind: 'keyword', re: /\b(?:true|false|null|yes|no|on|off)\b/i },
    { kind: 'operator', re: /[-?:|>]/ },
  ],
}

const css: Language = {
  rules: [
    { kind: 'comment', re: /\/\*[\s\S]*?\*\// },
    { kind: 'string', re: /"(?:\\.|[^"\\])*"/ },
    { kind: 'string', re: /'(?:\\.|[^'\\])*'/ },
    { kind: 'number', re: /-?\b\d+(?:\.\d+)?(?:%|px|em|rem|vh|vw|ch|ex|pt|pc|in|cm|mm|deg|rad|turn|s|ms|fr)?\b/ },
    { kind: 'keyword', re: /@[a-zA-Z-]+/ },
    { kind: 'property', re: /[-a-zA-Z]+(?=\s*:)/ },
    { kind: 'builtin', re: /#[0-9a-fA-F]{3,8}\b/ },
    { kind: 'tag', re: /\.[-\w]+|#[-\w]+|&|::?[-\w]+/ },
    { kind: 'punctuation', re: /[{};(),]/ },
  ],
}

const html: Language = {
  rules: [
    { kind: 'comment', re: /<!--[\s\S]*?-->/ },
    { kind: 'string', re: /"(?:\\.|[^"\\])*"/ },
    { kind: 'string', re: /'(?:\\.|[^'\\])*'/ },
    { kind: 'tag', re: /<\/?[A-Za-z][\w-]*/ },
    { kind: 'tag', re: /\/?>/ },
    { kind: 'attr', re: /\b[A-Za-z_:][\w:.-]*(?==)/ },
    { kind: 'punctuation', re: /=/ },
  ],
}

const GO_KEYWORDS = [
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
  'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
  'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type',
  'var', 'nil', 'true', 'false',
]

const GO_BUILTINS = [
  'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16',
  'uint32', 'uint64', 'float32', 'float64', 'string', 'bool', 'byte', 'rune',
  'error', 'make', 'new', 'len', 'cap', 'append', 'copy', 'delete', 'panic',
  'recover', 'print', 'println',
]

const go: Language = {
  rules: [
    { kind: 'comment', re: /\/\/[^\n]*/ },
    { kind: 'comment', re: /\/\*[\s\S]*?\*\// },
    { kind: 'string', re: /`[^`]*`/ },
    { kind: 'string', re: /"(?:\\.|[^"\\\n])*"/ },
    { kind: 'number', re: /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b/ },
    { kind: 'keyword', re: kw(GO_KEYWORDS) },
    { kind: 'builtin', re: kw(GO_BUILTINS) },
    { kind: 'operator', re: /[+\-*/%=<>!&|^~]+|:=/ },
    { kind: 'punctuation', re: /[{}[\]();,.:]/ },
  ],
}

const RUST_KEYWORDS = [
  'as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern',
  'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod',
  'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct',
  'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while', 'async',
  'await', 'dyn', 'box',
]

const RUST_BUILTINS = [
  'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'u8', 'u16', 'u32', 'u64',
  'u128', 'usize', 'f32', 'f64', 'bool', 'char', 'str', 'String', 'Vec',
  'Option', 'Result', 'Box', 'Rc', 'Arc', 'Some', 'None', 'Ok', 'Err',
]

const rust: Language = {
  rules: [
    { kind: 'comment', re: /\/\/[^\n]*/ },
    { kind: 'comment', re: /\/\*[\s\S]*?\*\// },
    { kind: 'string', re: /"(?:\\.|[^"\\\n])*"/ },
    { kind: 'string', re: /'(?:\\.|[^'\\])'/ },
    { kind: 'number', re: /\b(?:0x[\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?)(?:[iuf]\d+|usize|isize)?\b/ },
    { kind: 'keyword', re: kw(RUST_KEYWORDS) },
    { kind: 'builtin', re: kw(RUST_BUILTINS) },
    { kind: 'operator', re: /[+\-*/%=<>!&|^~?]+/ },
    { kind: 'punctuation', re: /[{}[\]();,.:]|::|->/ },
  ],
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'INTO', 'VALUES',
  'SET', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'ON', 'GROUP',
  'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'AND', 'OR', 'NOT',
  'NULL', 'IS', 'IN', 'LIKE', 'BETWEEN', 'CREATE', 'TABLE', 'DROP', 'ALTER',
  'INDEX', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'DEFAULT', 'UNIQUE',
  'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'UNION', 'ALL', 'WITH',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
]

const sql: Language = {
  rules: [
    { kind: 'comment', re: /--[^\n]*/ },
    { kind: 'comment', re: /\/\*[\s\S]*?\*\// },
    { kind: 'string', re: /'(?:''|[^'])*'/ },
    { kind: 'string', re: /"(?:""|[^"])*"/ },
    { kind: 'number', re: /\b\d+(?:\.\d+)?\b/ },
    { kind: 'keyword', re: new RegExp(`\\b(?:${SQL_KEYWORDS.join('|')})\\b`, 'i') },
    { kind: 'operator', re: /[+\-*/%=<>!]+/ },
    { kind: 'punctuation', re: /[(),;.]/ },
  ],
}

const markdown: Language = {
  rules: [
    { kind: 'comment', re: /<!--[\s\S]*?-->/ },
    { kind: 'keyword', re: /^#{1,6}[^\n]*/m },
    { kind: 'string', re: /`[^`\n]+`/ },
    { kind: 'string', re: /```[\s\S]*?```/ },
    { kind: 'builtin', re: /\[[^\]]*\]\([^)]*\)/ },
    { kind: 'property', re: /\*\*[^*\n]+\*\*|__[^_\n]+__/ },
    { kind: 'property', re: /\*[^*\n]+\*|_[^_\n]+_/ },
    { kind: 'operator', re: /^[-*+] |^\d+\. /m },
  ],
}

const LANGS: Record<string, Language> = {
  javascript: jsLike,
  typescript: jsLike,
  python,
  bash,
  json,
  yaml,
  css,
  html,
  go,
  rust,
  sql,
  markdown,
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function tokenize(code: string, lang: Language): string {
  const stickyRules = lang.rules.map((r) => ({
    kind: r.kind,
    re: new RegExp(r.re.source, r.re.flags.includes('y') ? r.re.flags : r.re.flags.replace('g', '') + 'y'),
  }))
  let out = ''
  let plain = ''
  let pos = 0
  const flushPlain = () => {
    if (plain) {
      out += escapeHtml(plain)
      plain = ''
    }
  }
  while (pos < code.length) {
    let matched = false
    for (const r of stickyRules) {
      r.re.lastIndex = pos
      const m = r.re.exec(code)
      if (m && m[0].length > 0) {
        flushPlain()
        out += `<span class="tok-${r.kind}">${escapeHtml(m[0])}</span>`
        pos += m[0].length
        matched = true
        break
      }
    }
    if (!matched) {
      plain += code[pos]
      pos++
    }
  }
  flushPlain()
  return out
}

function highlightDiff(code: string): string {
  const lines = code.split('\n')
  return lines
    .map((line) => {
      if (/^(?:---|\+\+\+)/.test(line)) {
        return `<span class="tok-comment">${escapeHtml(line)}</span>`
      }
      if (line.startsWith('@@')) {
        return `<span class="tok-hunk">${escapeHtml(line)}</span>`
      }
      if (line.startsWith('+')) {
        return `<span class="tok-insertion">${escapeHtml(line)}</span>`
      }
      if (line.startsWith('-')) {
        return `<span class="tok-deletion">${escapeHtml(line)}</span>`
      }
      return escapeHtml(line)
    })
    .join('\n')
}

export function resolveLanguage(lang: string | undefined): string | null {
  if (!lang) return null
  const normalized = lang.toLowerCase().trim().split(/\s+/)[0]
  return ALIASES[normalized] ?? null
}

export function highlight(code: string, lang: string | undefined): string {
  const resolved = resolveLanguage(lang)
  if (!resolved) return escapeHtml(code)
  if (resolved === 'diff') return highlightDiff(code)
  const def = LANGS[resolved]
  if (!def) return escapeHtml(code)
  return tokenize(code, def)
}
