import type { HTMLAttributes } from 'react'

interface TeamMemberBadgeProps extends HTMLAttributes<HTMLDivElement> {
  name: string
  email?: string
  role?: 'owner' | 'admin' | 'editor' | 'viewer'
  avatarUrl?: string
  size?: 'sm' | 'md' | 'lg'
}

const roleColors: Record<string, string> = {
  owner: 'bg-[var(--ctp-mauve)] text-[var(--ctp-base)]',
  admin: 'bg-[var(--ctp-blue)] text-[var(--ctp-base)]',
  editor: 'bg-[var(--ctp-green)] text-[var(--ctp-base)]',
  viewer: 'bg-[var(--ctp-overlay)] text-[var(--ctp-text)]',
}

const sizeClasses = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
}

export function TeamMemberBadge({
  name,
  email,
  role = 'editor',
  avatarUrl,
  size = 'md',
  className = '',
  ...props
}: TeamMemberBadgeProps) {
  const initials = name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div
      {...props}
      className={`flex items-center gap-3 ${className}`}
    >
      {/* Avatar */}
      <div
        className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-semibold overflow-hidden flex-shrink-0 ${
          avatarUrl ? '' : roleColors[role]
        }`}
        title={name}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          initials
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[var(--ctp-text)] truncate">{name}</p>
        {email && <p className="text-xs text-[var(--ctp-subtext)] truncate">{email}</p>}
      </div>

      {/* Role badge */}
      {role && (
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${roleColors[role]}`}>
          {role}
        </span>
      )}
    </div>
  )
}
