import type { JSX } from 'preact'
import type { ToolKind } from '../../api/types'

interface IconProps {
  class?: string
  'aria-hidden'?: boolean
}

function Svg({ children, ...props }: IconProps & { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
      {children}
    </svg>
  )
}

export function ToolKindIcon({ kind, class: cls }: { kind: ToolKind; class?: string }) {
  const className = cls ?? 'w-3.5 h-3.5'
  switch (kind) {
    case 'read':
      return (
        <Svg class={className}>
          <path d="M4 3.75A1.75 1.75 0 0 1 5.75 2h6.69c.464 0 .908.184 1.237.513l3.31 3.31c.329.328.513.773.513 1.236V16.25A1.75 1.75 0 0 1 15.75 18h-10A1.75 1.75 0 0 1 4 16.25V3.75Z" />
        </Svg>
      )
    case 'write':
      return (
        <Svg class={className}>
          <path d="M12.146 1.146a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-9 9A.5.5 0 0 1 9.5 17H3.5a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 1 .146-.354l9-9Z" />
        </Svg>
      )
    case 'edit':
      return (
        <Svg class={className}>
          <path d="M14.793 3.207a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414L7.414 16.586A2 2 0 0 1 6 17.172L3.293 17.5a.5.5 0 0 1-.554-.554L3.067 14.24A2 2 0 0 1 3.65 12.85L14.793 3.207Z" />
        </Svg>
      )
    case 'bash':
      return (
        <Svg class={className}>
          <path fill-rule="evenodd" d="M2 4.75A1.75 1.75 0 0 1 3.75 3h12.5A1.75 1.75 0 0 1 18 4.75v10.5A1.75 1.75 0 0 1 16.25 17H3.75A1.75 1.75 0 0 1 2 15.25V4.75Zm3.22 2.97a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-2 2a.75.75 0 1 1-1.06-1.06L6.69 10.25l-1.47-1.47a.75.75 0 0 1 0-1.06ZM10 13a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 0 1.5h-3A.75.75 0 0 1 10 13Z" clip-rule="evenodd" />
        </Svg>
      )
    case 'search':
    case 'glob':
      return (
        <Svg class={className}>
          <path fill-rule="evenodd" d="M9 3a6 6 0 1 0 3.708 10.71l3.541 3.54a1 1 0 0 0 1.415-1.414l-3.541-3.541A6 6 0 0 0 9 3Zm-4 6a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clip-rule="evenodd" />
        </Svg>
      )
    case 'web_fetch':
    case 'web_search':
      return (
        <Svg class={className}>
          <path fill-rule="evenodd" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm5.93 7H13.5a13.4 13.4 0 0 0-1.16-4.6A6.01 6.01 0 0 1 15.93 9ZM10 4c.45 0 1.42 1.74 1.85 5h-3.7C8.58 5.74 9.55 4 10 4ZM7.66 4.4A13.4 13.4 0 0 0 6.5 9H4.07a6.01 6.01 0 0 1 3.59-4.6ZM4.07 11H6.5c.13 1.71.55 3.32 1.16 4.6A6.01 6.01 0 0 1 4.07 11Zm4.43 0h3a13.4 13.4 0 0 1-1.5 4.6c-.43-.29-1.07-2-1.5-4.6Zm3.84 4.6c.61-1.28 1.03-2.89 1.16-4.6h2.43a6.01 6.01 0 0 1-3.59 4.6Z" clip-rule="evenodd" />
        </Svg>
      )
    case 'browser':
      return (
        <Svg class={className}>
          <path fill-rule="evenodd" d="M2 5.25A2.25 2.25 0 0 1 4.25 3h11.5A2.25 2.25 0 0 1 18 5.25v9.5A2.25 2.25 0 0 1 15.75 17H4.25A2.25 2.25 0 0 1 2 14.75v-9.5ZM4.25 6a.75.75 0 0 0 0 1.5H6a.75.75 0 0 0 0-1.5H4.25Zm3.5 0a.75.75 0 0 0 0 1.5h7.5a.75.75 0 0 0 0-1.5h-7.5Z" clip-rule="evenodd" />
        </Svg>
      )
    case 'task':
      return (
        <Svg class={className}>
          <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd" />
        </Svg>
      )
    case 'todo':
      return (
        <Svg class={className}>
          <path fill-rule="evenodd" d="M5 3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5Zm3.78 4.97a.75.75 0 0 1 0 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0L4.22 9.97a.75.75 0 0 1 1.06-1.06L6 9.629l1.72-1.72a.75.75 0 0 1 1.06.06Zm2.97 1.28a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5h-4Z" clip-rule="evenodd" />
        </Svg>
      )
    case 'notebook':
      return (
        <Svg class={className}>
          <path d="M3 4.75A1.75 1.75 0 0 1 4.75 3h10.5A1.75 1.75 0 0 1 17 4.75v10.5A1.75 1.75 0 0 1 15.25 17H4.75A1.75 1.75 0 0 1 3 15.25V4.75Zm2.5 1a.5.5 0 0 0 0 1H7.5a.5.5 0 0 0 0-1H5.5Zm0 3a.5.5 0 0 0 0 1H14.5a.5.5 0 0 0 0-1H5.5Zm0 3a.5.5 0 0 0 0 1H14.5a.5.5 0 0 0 0-1H5.5Z" />
        </Svg>
      )
    case 'mcp':
      return (
        <Svg class={className}>
          <path fill-rule="evenodd" d="M10 2a1 1 0 0 1 1 1v1.07a6.002 6.002 0 0 1 4.93 4.93H17a1 1 0 1 1 0 2h-1.07a6.002 6.002 0 0 1-4.93 4.93V17a1 1 0 1 1-2 0v-1.07a6.002 6.002 0 0 1-4.93-4.93H3a1 1 0 1 1 0-2h1.07A6.002 6.002 0 0 1 9 4.07V3a1 1 0 0 1 1-1Zm0 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" clip-rule="evenodd" />
        </Svg>
      )
    case 'other':
    default:
      return (
        <Svg class={className}>
          <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13.25a.75.75 0 0 0-1.5 0v5a.75.75 0 0 0 1.5 0v-5ZM10 13a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" clip-rule="evenodd" />
        </Svg>
      )
  }
}

export function ChevronIcon({ open, class: cls }: { open: boolean; class?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      class={`${cls ?? 'w-3.5 h-3.5'} transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 0 1 0-1.06L10.94 10 7.21 6.29a.75.75 0 0 1 1.06-1.06l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0Z" clip-rule="evenodd" />
    </svg>
  )
}

export function StatusIcon({ severity, class: cls }: { severity: 'info' | 'warn' | 'error'; class?: string }) {
  const className = cls ?? 'w-3.5 h-3.5'
  if (severity === 'error') {
    return (
      <Svg class={className}>
        <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-1-9.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 6.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" />
      </Svg>
    )
  }
  if (severity === 'warn') {
    return (
      <Svg class={className}>
        <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875C18.464 14.539 17.62 16 16.276 16H3.724c-1.345 0-2.189-1.461-1.519-2.63l6.28-10.875ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" />
      </Svg>
    )
  }
  return (
    <Svg class={className}>
      <path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8.75-4.75a.75.75 0 0 1 1.5 0v.5a.75.75 0 0 1-1.5 0v-.5Zm0 3.5a.75.75 0 0 1 1.5 0v5a.75.75 0 0 1-1.5 0v-5Z" clip-rule="evenodd" />
    </Svg>
  )
}

export function BrainIcon({ class: cls }: { class?: string }) {
  return (
    <Svg class={cls ?? 'w-3.5 h-3.5'}>
      <path d="M6 2a3 3 0 0 0-3 3v.17A3 3 0 0 0 1 8a3 3 0 0 0 1.17 2.38A3 3 0 0 0 4 15a3 3 0 0 0 3 3 3 3 0 0 0 3-3V5a3 3 0 0 0-3-3H6Zm8 0a3 3 0 0 1 3 3v.17A3 3 0 0 1 19 8a3 3 0 0 1-1.17 2.38A3 3 0 0 1 16 15a3 3 0 0 1-3 3 3 3 0 0 1-3-3V5a3 3 0 0 1 3-3h1Z" />
    </Svg>
  )
}
