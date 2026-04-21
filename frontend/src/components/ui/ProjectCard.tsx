import { Link } from 'react-router-dom'
import type { HTMLAttributes } from 'react'
import { ClipStatusBadge } from './ClipStatusBadge'
import { formatDuration } from '../../utils/format'

interface ProjectCardProps {
  projectId: string
  title: string
  thumbnailUrl?: string
  duration?: number
  clipCount: number
  status: 'pending' | 'processing' | 'complete' | 'failed'
  createdAt: number
  teamName?: string
  className?: string
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
}

export function ProjectCard({
  projectId,
  title,
  thumbnailUrl,
  duration,
  clipCount,
  status,
  createdAt,
  teamName,
  className = '',
  onClick,
}: ProjectCardProps) {
  const formattedDate = new Date(createdAt * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  const formattedDuration = duration ? formatDuration(duration) : null

  return (
    <Link
      to={`/video/${projectId}`}
      className={`glass-card p-4 hover:border-[var(--ctp-mauve)] transition-all block group ${className}`}
      onClick={onClick}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video rounded-lg bg-[var(--ctp-surface-1)] overflow-hidden mb-3">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg
              className="w-12 h-12 text-[var(--ctp-overlay)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
        )}

        {/* Duration overlay */}
        {formattedDuration && (
          <div className="absolute bottom-2 right-2 px-2 py-1 rounded text-[10px] font-medium bg-[var(--ctp-base)]/90 text-[var(--ctp-text)]">
            {formattedDuration}
          </div>
        )}

        {/* Status indicator */}
        <div className="absolute top-2 left-2">
          <ClipStatusBadge status={status} size="sm" />
        </div>
      </div>

      {/* Info */}
      <h3 className="font-semibold text-[var(--ctp-text)] truncate mb-1 group-hover:text-[var(--ctp-mauve)] transition-colors">
        {title}
      </h3>

      <div className="flex items-center justify-between text-xs text-[var(--ctp-subtext)]">
        <span>{clipCount} clips</span>
        <span>{formattedDate}</span>
      </div>

      {/* Team badge */}
      {teamName && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--ctp-subtext)]">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <span className="truncate">{teamName}</span>
        </div>
      )}
    </Link>
  )
}

