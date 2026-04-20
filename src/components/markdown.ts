import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { highlight, resolveLanguage } from './highlight'

marked.setOptions({ gfm: true, breaks: true })

marked.use({
  renderer: {
    code({ text, lang }) {
      const rawLang = (lang ?? '').trim().split(/\s+/)[0]
      if (rawLang === 'mermaid') {
        const escaped = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        return `<pre><code class="language-mermaid">${escaped}\n</code></pre>\n`
      }
      const resolved = resolveLanguage(rawLang)
      const className = resolved
        ? `hljs language-${resolved}`
        : rawLang
          ? `hljs language-${rawLang}`
          : 'hljs'
      const body = highlight(text, rawLang)
      const button =
        '<button type="button" data-copy aria-label="Copy code to clipboard" ' +
        'class="code-copy-btn absolute top-2 right-2 text-[11px] leading-none px-2 py-1 rounded ' +
        'bg-slate-700/70 hover:bg-slate-600 text-slate-100 select-none transition-colors ' +
        'focus:outline-none focus:ring-2 focus:ring-indigo-400">Copy</button>'
      return `<div class="code-block-wrap relative"><pre><code class="${className}">${body}\n</code></pre>${button}</div>\n`
    },
  },
})

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'del', 'ins', 'span', 'div', 'button',
]

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class', 'type', 'aria-label', 'data-copy']

export function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string
  return DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR })
}
