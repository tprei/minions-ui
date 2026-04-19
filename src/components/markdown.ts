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
      return `<pre><code class="${className}">${body}\n</code></pre>\n`
    },
  },
})

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'del', 'ins', 'span', 'div',
]

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class']

export function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string
  return DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR })
}
