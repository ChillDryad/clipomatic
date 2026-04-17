import type { HTMLAttributes, ReactNode } from 'react'

type ClipStatus = 'pending' | 'processing' | 'complete' | 'failed'

interface ClipStatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: ClipStatus
  children?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const statusConfig: Record<ClipStatus, { variant: string; label: string; icon: ReactNode }> = {
  pending: {
    variant: 'badge-mauve',
    label: 'Pending',
    icon: (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  processing: {
    variant: 'badge-yellow',
    label: 'Processing',
    icon: (
      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    ),
  },
  complete: {
    variant: 'badge-green',
    label: 'Complete',
    icon: (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
  failed: {
    variant: 'badge-red',
    label: 'Failed',
    icon: (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
  },
}

export function ClipStatusBadge({ status, children, className = '', size = 'md', ...props }: ClipStatusBadgeProps) {
  const config = statusConfig[status]
  const sizeClass = size === 'sm' ? 'text-[10px] gap-1' : size === 'lg' ? 'text-base gap-2' : 'text-xs gap-1.5'

  return (
    <span
      {...props}
      className={`badge ${config.variant} inline-flex items-center gap-1.5 ${sizeClass} ${className}`}
    >
      {config.icon}
      {children || config.label}
    </span>
  )
}
