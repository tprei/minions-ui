import type { ComponentChildren } from 'preact'
import { MIN_TOUCH_TARGET_SIZE } from './constants'

export interface TouchTargetProps {
  children: ComponentChildren
  className?: string
  minSize?: number
  onClick?: (e: MouseEvent) => void
  onPointerDown?: (e: PointerEvent) => void
  onPointerUp?: (e: PointerEvent) => void
  disabled?: boolean
  ariaLabel?: string
  ariaPressed?: boolean
  role?: string
  type?: 'button' | 'submit' | 'reset'
  tabIndex?: number
}

export function TouchTarget({
  children,
  className = '',
  minSize = MIN_TOUCH_TARGET_SIZE,
  onClick,
  onPointerDown,
  onPointerUp,
  disabled = false,
  ariaLabel,
  ariaPressed,
  role,
  type = 'button',
  tabIndex,
}: TouchTargetProps) {
  const style = {
    minWidth: `${minSize}px`,
    minHeight: `${minSize}px`,
  }

  const Element = onClick || onPointerDown || onPointerUp ? 'button' : 'div'

  const baseProps = {
    class: `inline-flex items-center justify-center ${className}`,
    style,
    onClick,
    onPointerDown,
    onPointerUp,
    disabled: Element === 'button' ? disabled : undefined,
    'aria-label': ariaLabel,
    'aria-pressed': ariaPressed,
    type: Element === 'button' ? type : undefined,
    tabIndex: tabIndex ?? (disabled ? -1 : 0),
  }

  const roleValue = role || (Element === 'button' ? undefined : 'button')

  // @ts-expect-error - role prop type mismatch between string and Preact Signal type
  return <Element {...baseProps} role={roleValue}>{children}</Element>
}
