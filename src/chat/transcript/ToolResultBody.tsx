import type { ToolResultEvent } from '../../api/types'
import { MarkdownView } from '../../components/MarkdownView'

interface Props {
  event: ToolResultEvent
}

export function ToolResultBody({ event }: Props) {
  const { result } = event
  if (result.status === 'pending') {
    return (
      <div
        class="text-[11px] italic text-slate-500 dark:text-slate-400 px-3 py-2"
        data-testid="transcript-tool-result-pending"
      >
        Waiting for result…
      </div>
    )
  }
  if (result.status === 'error') {
    return (
      <div
        class="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs"
        data-testid="transcript-tool-result-error"
      >
        <div class="font-semibold text-red-700 dark:text-red-300 mb-1">Error</div>
        {result.error && (
          <div class="font-mono whitespace-pre-wrap break-words text-red-700 dark:text-red-300">
            {result.error}
          </div>
        )}
        {result.text && (
          <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-red-800 dark:text-red-200">
            {result.text}
          </pre>
        )}
      </div>
    )
  }
  return (
    <div data-testid="transcript-tool-result-ok">
      {renderBody(event)}
      <ResultMeta event={event} />
    </div>
  )
}

function renderBody(event: ToolResultEvent) {
  const { result } = event
  if (result.images && result.images.length > 0) {
    return (
      <div class="flex flex-wrap gap-2 px-3 py-2" data-testid="transcript-tool-result-images">
        {result.images.map((url, i) => (
          <img
            key={i}
            src={url}
            alt={`tool image ${i + 1}`}
            class="max-w-[200px] max-h-[200px] rounded border border-slate-200 dark:border-slate-700"
          />
        ))}
        {result.text && <ResultText text={result.text} format={result.format} />}
      </div>
    )
  }
  if (!result.text) {
    return (
      <div class="text-[11px] italic text-slate-500 dark:text-slate-400 px-3 py-2">
        (no output)
      </div>
    )
  }
  return <ResultText text={result.text} format={result.format} />
}

function ResultText({ text, format }: { text: string; format?: ToolResultEvent['result']['format'] }) {
  if (format === 'markdown') {
    return (
      <div class="px-3 py-2 max-h-96 overflow-auto" data-testid="transcript-tool-result-markdown">
        <MarkdownView
          source={text}
          class="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-pre:rounded prose-pre:px-2 prose-pre:py-1.5 prose-pre:text-[11px]"
        />
      </div>
    )
  }
  if (format === 'diff') {
    return (
      <pre
        class="px-3 py-2 max-h-96 overflow-auto whitespace-pre font-mono text-[11px] text-slate-700 dark:text-slate-300 leading-snug"
        data-testid="transcript-tool-result-diff"
      >
        {renderDiffLines(text)}
      </pre>
    )
  }
  if (format === 'json') {
    return (
      <pre
        class="px-3 py-2 max-h-96 overflow-auto whitespace-pre font-mono text-[11px] text-slate-700 dark:text-slate-300 leading-snug"
        data-testid="transcript-tool-result-json"
      >
        {prettyJson(text)}
      </pre>
    )
  }
  return (
    <pre
      class="px-3 py-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-slate-700 dark:text-slate-300 leading-snug"
      data-testid="transcript-tool-result-text"
    >
      {text}
    </pre>
  )
}

function ResultMeta({ event }: { event: ToolResultEvent }) {
  const { result } = event
  if (!result.truncated && result.originalBytes === undefined) return null
  return (
    <div class="flex items-center gap-2 px-3 pb-2 text-[10px] text-slate-500 dark:text-slate-400">
      {result.truncated && <span class="rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-1.5 py-0.5">truncated</span>}
      {result.originalBytes !== undefined && <span>{formatBytes(result.originalBytes)}</span>}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function renderDiffLines(text: string) {
  const lines = text.split('\n')
  return lines.map((line, idx) => {
    const nl = idx < lines.length - 1 ? '\n' : ''
    let cls = ''
    if (line.startsWith('+++') || line.startsWith('---')) {
      cls = 'text-slate-500 dark:text-slate-400 font-semibold'
    } else if (line.startsWith('@@')) {
      cls = 'text-sky-700 dark:text-sky-300'
    } else if (line.startsWith('+')) {
      cls = 'text-green-700 dark:text-green-400'
    } else if (line.startsWith('-')) {
      cls = 'text-red-700 dark:text-red-400'
    } else if (line.startsWith('diff --git')) {
      cls = 'text-slate-500 dark:text-slate-400 font-semibold'
    }
    if (!cls) {
      return <span key={idx}>{line + nl}</span>
    }
    return (
      <span key={idx} class={cls}>
        {line + nl}
      </span>
    )
  })
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
