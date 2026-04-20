import type { JSX } from 'preact'

export interface SkeletonProps {
  class?: string
  width?: string | number
  height?: string | number
  rounded?: 'sm' | 'md' | 'full'
  'data-testid'?: string
}

export function Skeleton({
  class: className = '',
  width,
  height,
  rounded = 'md',
  ...rest
}: SkeletonProps): JSX.Element {
  const roundedClass =
    rounded === 'full' ? 'rounded-full' : rounded === 'sm' ? 'rounded' : 'rounded-md'
  const style: JSX.CSSProperties = {}
  if (width !== undefined) style.width = typeof width === 'number' ? `${width}px` : width
  if (height !== undefined) style.height = typeof height === 'number' ? `${height}px` : height
  return (
    <div
      class={`animate-pulse bg-slate-200 dark:bg-slate-700 ${roundedClass} ${className}`.trim()}
      style={style}
      aria-hidden="true"
      data-testid={rest['data-testid']}
    />
  )
}

export interface SkeletonLinesProps {
  count?: number
  class?: string
  lineHeight?: number
  lastLineWidth?: string
}

export function SkeletonLines({
  count = 3,
  class: className = '',
  lineHeight = 10,
  lastLineWidth = '60%',
}: SkeletonLinesProps): JSX.Element {
  return (
    <div class={`flex flex-col gap-2 ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const width = i === count - 1 ? lastLineWidth : '100%'
        return <Skeleton key={i} height={lineHeight} width={width} />
      })}
    </div>
  )
}
