import { useEffect, useMemo, useRef } from 'preact/hooks'
import { renderMarkdown } from './markdown'

type MermaidModule = typeof import('mermaid').default

let mermaidPromise: Promise<MermaidModule> | null = null

function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      const isDark =
        typeof document !== 'undefined' &&
        document.documentElement.getAttribute('data-theme') === 'dark'
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'strict',
      })
      return mermaid
    })
  }
  return mermaidPromise
}

let mermaidIdCounter = 0

interface MarkdownViewProps {
  source: string
  class?: string
  'data-testid'?: string
}

export function MarkdownView({ source, class: className, 'data-testid': testId }: MarkdownViewProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdown(source), [source])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const timers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()
    const onClick = (e: Event) => {
      const target = e.target
      if (!(target instanceof Element)) return
      const btn = target.closest<HTMLButtonElement>('button[data-copy]')
      if (!btn || !root.contains(btn)) return
      const code = btn.parentElement?.querySelector('pre > code')
      if (!code) return
      const text = code.textContent ?? ''
      const showState = (label: string) => {
        btn.textContent = label
        const existing = timers.get(btn)
        if (existing) clearTimeout(existing)
        timers.set(
          btn,
          setTimeout(() => {
            btn.textContent = 'Copy'
            timers.delete(btn)
          }, 1500),
        )
      }
      const clip = navigator.clipboard
      if (clip && typeof clip.writeText === 'function') {
        clip.writeText(text).then(
          () => showState('Copied'),
          () => showState('Failed'),
        )
      } else {
        showState('Failed')
      }
    }
    root.addEventListener('click', onClick)
    return () => {
      root.removeEventListener('click', onClick)
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    }
  }, [html])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const blocks = Array.from(
      root.querySelectorAll<HTMLElement>('pre > code.language-mermaid'),
    )
    if (blocks.length === 0) return

    let cancelled = false
    void (async () => {
      let mermaid: MermaidModule
      try {
        mermaid = await loadMermaid()
      } catch {
        return
      }
      if (cancelled) return

      for (const code of blocks) {
        const pre = code.parentElement
        if (!pre) continue
        const src = code.textContent ?? ''
        const id = `mmd-${Date.now().toString(36)}-${mermaidIdCounter++}`
        try {
          const { svg } = await mermaid.render(id, src)
          if (cancelled) return
          const wrap = document.createElement('div')
          wrap.className = 'mermaid-diagram my-2 overflow-x-auto'
          wrap.innerHTML = svg
          pre.replaceWith(wrap)
        } catch (err) {
          if (cancelled) return
          const note = document.createElement('div')
          note.className = 'text-xs text-red-600 dark:text-red-400 mt-1'
          note.textContent = `mermaid: ${err instanceof Error ? err.message : String(err)}`
          pre.after(note)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [html])

  return (
    <div
      ref={rootRef}
      class={className}
      data-testid={testId}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
