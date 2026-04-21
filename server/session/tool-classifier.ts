import type { ToolCallSummary, ToolKind, ToolResultFormat, ToolResultPayload } from '../../shared/api-types'

const MAX_SUBTITLE = 120
const UNKNOWN_TOOL_NAME = 'unknown'
const FILE_BYTES = 32 * 1024
const BASH_BYTES = 64 * 1024

const FILE_PATH_KEYS = ['file_path', 'path', 'filePath', 'target_file'] as const
const BASH_COMMAND_KEYS = ['command', 'cmd', 'script'] as const
const SEARCH_PATTERN_KEYS = ['pattern', 'query', 'search'] as const
const URL_KEYS = ['url', 'href'] as const

function firstString(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = input[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

function truncateStr(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}

function truncateToBytes(s: string, maxBytes: number): string {
  if (byteLength(s) <= maxBytes) return s
  let lo = 0
  let hi = s.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (byteLength(s.slice(0, mid)) <= maxBytes) lo = mid
    else hi = mid - 1
  }
  return s.slice(0, lo)
}

export function parseMcpName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith('mcp__')) return null
  const rest = name.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  if (sep <= 0) return { server: rest || 'unknown', tool: '' }
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) }
}

interface ClassifiedTool {
  kind: ToolKind
  title: string
  subtitle?: string
}

type KindResolver = (args: Record<string, unknown>) => ClassifiedTool

const KIND_RESOLVERS: Record<string, KindResolver> = {
  Read: (a) => ({ kind: 'read', title: 'Read file', subtitle: firstString(a, FILE_PATH_KEYS) }),
  Write: (a) => ({ kind: 'write', title: 'Write file', subtitle: firstString(a, FILE_PATH_KEYS) }),
  Edit: (a) => ({ kind: 'edit', title: 'Edit file', subtitle: firstString(a, FILE_PATH_KEYS) }),
  MultiEdit: (a) => ({ kind: 'edit', title: 'Edit file (multi)', subtitle: firstString(a, FILE_PATH_KEYS) }),
  multi_edit: (a) => ({ kind: 'edit', title: 'Edit file (multi)', subtitle: firstString(a, FILE_PATH_KEYS) }),
  multiedit: (a) => ({ kind: 'edit', title: 'Edit file (multi)', subtitle: firstString(a, FILE_PATH_KEYS) }),
  NotebookEdit: (a) => ({ kind: 'notebook', title: 'Edit notebook', subtitle: firstString(a, ['notebook_path', ...FILE_PATH_KEYS]) }),
  NotebookRead: (a) => ({ kind: 'notebook', title: 'Read notebook', subtitle: firstString(a, FILE_PATH_KEYS) }),
  notebookedit: (a) => ({ kind: 'notebook', title: 'Edit notebook', subtitle: firstString(a, ['notebook_path', ...FILE_PATH_KEYS]) }),
  notebookread: (a) => ({ kind: 'notebook', title: 'Read notebook', subtitle: firstString(a, FILE_PATH_KEYS) }),
  Bash: (a) => ({ kind: 'bash', title: 'Run shell', subtitle: firstString(a, BASH_COMMAND_KEYS) }),
  bash: (a) => ({ kind: 'bash', title: 'Run shell', subtitle: firstString(a, BASH_COMMAND_KEYS) }),
  shell: (a) => ({ kind: 'bash', title: 'Run shell', subtitle: firstString(a, BASH_COMMAND_KEYS) }),
  BashOutput: () => ({ kind: 'bash', title: 'Read background output' }),
  bashoutput: () => ({ kind: 'bash', title: 'Read background output' }),
  KillShell: () => ({ kind: 'bash', title: 'Kill background shell' }),
  killshell: () => ({ kind: 'bash', title: 'Kill background shell' }),
  Grep: (a) => ({ kind: 'search', title: 'Search', subtitle: firstString(a, SEARCH_PATTERN_KEYS) }),
  grep: (a) => ({ kind: 'search', title: 'Search', subtitle: firstString(a, SEARCH_PATTERN_KEYS) }),
  search: (a) => ({ kind: 'search', title: 'Search', subtitle: firstString(a, SEARCH_PATTERN_KEYS) }),
  Glob: (a) => ({ kind: 'glob', title: 'List files', subtitle: firstString(a, ['pattern', 'path']) }),
  glob: (a) => ({ kind: 'glob', title: 'List files', subtitle: firstString(a, ['pattern', 'path']) }),
  WebFetch: (a) => ({ kind: 'web_fetch', title: 'Fetch URL', subtitle: firstString(a, URL_KEYS) }),
  webfetch: (a) => ({ kind: 'web_fetch', title: 'Fetch URL', subtitle: firstString(a, URL_KEYS) }),
  web_fetch: (a) => ({ kind: 'web_fetch', title: 'Fetch URL', subtitle: firstString(a, URL_KEYS) }),
  WebSearch: (a) => ({ kind: 'web_search', title: 'Web search', subtitle: firstString(a, ['query', 'search_query']) }),
  websearch: (a) => ({ kind: 'web_search', title: 'Web search', subtitle: firstString(a, ['query', 'search_query']) }),
  web_search: (a) => ({ kind: 'web_search', title: 'Web search', subtitle: firstString(a, ['query', 'search_query']) }),
  Task: (a) => ({ kind: 'task', title: 'Delegate to agent', subtitle: firstString(a, ['description', 'prompt', 'subagent_type']) }),
  task: (a) => ({ kind: 'task', title: 'Delegate to agent', subtitle: firstString(a, ['description', 'prompt', 'subagent_type']) }),
  agent: (a) => ({ kind: 'task', title: 'Delegate to agent', subtitle: firstString(a, ['description', 'prompt']) }),
  TodoWrite: () => ({ kind: 'todo', title: 'Update todo list' }),
  todowrite: () => ({ kind: 'todo', title: 'Update todo list' }),
  TodoRead: () => ({ kind: 'todo', title: 'Read todo list' }),
  todoread: () => ({ kind: 'todo', title: 'Read todo list' }),
}

function classifyBrowserTool(name: string, args: Record<string, unknown>): ClassifiedTool {
  const parsed = parseMcpName(name)
  const tool = parsed?.tool ?? name
  const action = tool.startsWith('browser_') ? tool.slice('browser_'.length) : tool
  const subtitle = firstString(args, ['url', 'selector', 'text', 'ref', 'element', 'path', 'filename'])
  const pretty = action.length > 0 ? action.replace(/_/g, ' ') : 'browser'
  const title = /take_screenshot|screenshot/i.test(action) ? 'Browser screenshot' : `Browser · ${pretty}`
  return { kind: 'browser', title, subtitle }
}

function classifyMcpTool(name: string, args: Record<string, unknown>): ClassifiedTool {
  const parsed = parseMcpName(name)
  if (parsed?.server === 'playwright' || /browser_/.test(parsed?.tool ?? '')) {
    return classifyBrowserTool(name, args)
  }
  const server = parsed?.server ?? 'mcp'
  const tool = parsed?.tool ?? name
  const subtitle = firstString(args, [...URL_KEYS, 'query', 'repo', 'owner', 'issue_number', 'pull_number', 'project', 'path', 'target_id'])
  const label = tool.length > 0 ? `${server} · ${tool.replace(/_/g, ' ')}` : server
  return { kind: 'mcp', title: label, subtitle }
}

export function classifyTool(name: string): ToolKind {
  return classifyToolFull(name, {}).kind
}

function classifyToolFull(name: string, args: Record<string, unknown>): ClassifiedTool {
  const resolved = typeof name === 'string' && name.length > 0 ? name : UNKNOWN_TOOL_NAME

  const direct = KIND_RESOLVERS[resolved]
  if (direct) {
    const out = direct(args)
    return {
      kind: out.kind,
      title: out.title,
      subtitle: out.subtitle ? truncateStr(out.subtitle, MAX_SUBTITLE) : undefined,
    }
  }

  if (resolved.startsWith('mcp__')) {
    const out = classifyMcpTool(resolved, args)
    return {
      kind: out.kind,
      title: out.title,
      subtitle: out.subtitle ? truncateStr(out.subtitle, MAX_SUBTITLE) : undefined,
    }
  }

  if (resolved.startsWith('browser_')) {
    const out = classifyBrowserTool(resolved, args)
    return {
      kind: out.kind,
      title: out.title,
      subtitle: out.subtitle ? truncateStr(out.subtitle, MAX_SUBTITLE) : undefined,
    }
  }

  return { kind: 'other', title: resolved }
}

export function buildToolCallSummary(args: {
  toolUseId: string
  name: string
  input: Record<string, unknown>
  parentToolUseId?: string | null
}): ToolCallSummary {
  const name = typeof args.name === 'string' && args.name.length > 0 ? args.name : UNKNOWN_TOOL_NAME
  const classified = classifyToolFull(name, args.input)
  const summary: ToolCallSummary = {
    toolUseId: args.toolUseId,
    name,
    kind: classified.kind,
    title: classified.title,
    input: args.input,
  }
  if (classified.subtitle) summary.subtitle = classified.subtitle
  if (args.parentToolUseId) summary.parentToolUseId = args.parentToolUseId
  return summary
}

interface ExtractedResult {
  text: string | undefined
  images: string[]
  isError: boolean
  meta: Record<string, unknown>
}

function appendImage(images: string[], item: Record<string, unknown>): void {
  const data = typeof item['data'] === 'string' ? item['data'] : undefined
  if (data) {
    const mime =
      typeof item['mimeType'] === 'string'
        ? item['mimeType']
        : 'image/png'
    images.push(`data:${mime};base64,${data}`)
    return
  }
  const source = item['source']
  if (source && typeof source === 'object') {
    const src = source as { data?: unknown; media_type?: unknown; url?: unknown }
    if (typeof src.url === 'string') {
      images.push(src.url)
      return
    }
    if (typeof src.data === 'string') {
      const mime = typeof src.media_type === 'string' ? src.media_type : 'image/png'
      images.push(`data:${mime};base64,${src.data}`)
      return
    }
  }
  if (typeof item['path'] === 'string') images.push(item['path'])
  else if (typeof item['url'] === 'string') images.push(item['url'])
}

function extractTextFromContent(raw: unknown): ExtractedResult {
  const texts: string[] = []
  const images: string[] = []
  const meta: Record<string, unknown> = {}
  let isError = false

  const walk = (node: unknown): void => {
    if (node == null) return
    if (typeof node === 'string') {
      if (node.length > 0) texts.push(node)
      return
    }
    if (typeof node === 'number' || typeof node === 'boolean') {
      texts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (typeof node !== 'object') return

    const obj = node as Record<string, unknown>
    const type = typeof obj['type'] === 'string' ? obj['type'] : undefined

    if (type === 'text' && typeof obj['text'] === 'string') {
      texts.push(obj['text'])
      return
    }
    if (type === 'image') {
      appendImage(images, obj)
      return
    }
    if (type === 'resource' || type === 'resource_link') {
      const resource = (obj['resource'] as Record<string, unknown> | undefined) ?? obj
      if (typeof resource['text'] === 'string') {
        texts.push(resource['text'])
        return
      }
      if (typeof resource['uri'] === 'string') {
        texts.push(resource['uri'])
        return
      }
    }

    if (obj['is_error'] === true || obj['isError'] === true) isError = true
    if (Array.isArray(obj['content'])) {
      walk(obj['content'])
      return
    }
    if (typeof obj['text'] === 'string') {
      texts.push(obj['text'])
      return
    }
    if (typeof obj['output'] === 'string') texts.push(obj['output'])
    if (typeof obj['stdout'] === 'string' && (obj['stdout'] as string).length > 0) texts.push(obj['stdout'])
    if (typeof obj['stderr'] === 'string' && (obj['stderr'] as string).length > 0) texts.push(obj['stderr'])
    if (typeof obj['error'] === 'string') {
      isError = true
      texts.push(obj['error'])
    }
    if (typeof obj['exitCode'] === 'number') meta['exitCode'] = obj['exitCode']
    else if (typeof obj['exit_code'] === 'number') meta['exitCode'] = obj['exit_code']
    if (typeof obj['cwd'] === 'string') meta['cwd'] = obj['cwd']
    if (typeof obj['url'] === 'string' && !Array.isArray(obj['content'])) meta['url'] = obj['url']
  }

  walk(raw)

  const text = texts.length > 0 ? texts.join('\n') : undefined
  return { text, images, isError, meta }
}

function detectFormat(kind: ToolKind, text: string | undefined): ToolResultFormat | undefined {
  if (!text) return undefined
  const trimmed = text.trimStart()
  if (/^(diff --git|---\s|\+\+\+\s|@@ )/m.test(trimmed)) return 'diff'
  if (kind === 'web_fetch' || kind === 'web_search') return 'markdown'
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      // not JSON
    }
  }
  return undefined
}

function budgetFor(kind: ToolKind): number {
  switch (kind) {
    case 'bash':
      return BASH_BYTES
    default:
      return FILE_BYTES
  }
}

export function buildToolResultPayload(args: {
  content: unknown
  toolKind?: ToolKind
}): ToolResultPayload {
  const kind = args.toolKind ?? 'other'
  const extracted = extractTextFromContent(args.content)

  const originalBytes = extracted.text ? byteLength(extracted.text) : 0
  const maxBytes = budgetFor(kind)
  const isTruncated = originalBytes > maxBytes

  let text = extracted.text
  if (text && isTruncated) text = truncateToBytes(text, maxBytes) + '\n…[truncated]'

  const payload: ToolResultPayload = {
    status: extracted.isError ? 'error' : 'ok',
  }

  if (text !== undefined) payload.text = text
  if (isTruncated) {
    payload.truncated = true
    payload.originalBytes = originalBytes
  }
  if (extracted.images.length > 0) payload.images = extracted.images
  if (Object.keys(extracted.meta).length > 0) payload.meta = extracted.meta

  const format = detectFormat(kind, text)
  if (format !== undefined) payload.format = format

  if (payload.status === 'error' && text && text.length > 0) {
    payload.error = truncateStr(text, 500)
  }

  return payload
}
