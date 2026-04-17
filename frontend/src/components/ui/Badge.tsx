import type { HTMLAttributes, ReactNode } from 'react'

type BadgeVariant = 'green' | 'yellow' | 'red' | 'mauve' | 'blue'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  children: ReactNode
}

const variantClasses: Record<BadgeVariant, string> = {
  green: 'badge-green',
  yellow: 'badge-yellow',
  red: 'badge-red',
  mauve: 'badge-mauve',
  blue: 'badge-blue',
}

export function Badge({ variant = 'mauve', children, className = '', ...props }: BadgeProps) {
  return (
    <span {...props} className={`badge-${variant} ${className}`}>
      {children}
    </span>
  )
}
