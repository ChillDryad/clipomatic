import { useState, useRef, useEffect } from 'react'

type Role = 'owner' | 'admin' | 'editor' | 'viewer'

interface RoleSelectorProps {
  value: Role
  onChange: (role: Role) => void
  disabled?: boolean
  currentRole?: Role  // User's own role (can't promote above their own)
}

const ROLE_INFO: Record<Role, { label: string; color: string; description: string }> = {
  owner: {
    label: 'Owner',
    color: 'var(--ctp-mauve)',
    description: 'Full control including delete team',
  },
  admin: {
    label: 'Admin',
    color: 'var(--ctp-blue)',
    description: 'Can manage members and projects',
  },
  editor: {
    label: 'Editor',
    color: 'var(--ctp-green)',
    description: 'Can create and edit clips',
  },
  viewer: {
    label: 'Viewer',
    color: 'var(--ctp-overlay)',
    description: 'Can view projects only',
  },
}

const ROLE_PERMISSIONS: Record<Role, string[]> = {
  owner: ['All permissions', 'Delete team', 'Transfer ownership'],
  admin: ['View projects', 'Create/edit clips', 'Invite/remove members'],
  editor: ['View projects', 'Create/edit clips', 'Render clips'],
  viewer: ['View projects', 'Watch clips'],
}

export function RoleSelector({ value, onChange, disabled = false, currentRole }: RoleSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Can't change role if disabled or if trying to promote above own role
  const canChangeRole = (role: Role): boolean => {
    if (disabled || !currentRole) return !disabled
    const roleHierarchy: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 }
    return roleHierarchy[role] <= roleHierarchy[currentRole]
  }

  const currentRoleInfo = ROLE_INFO[value]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
          disabled
            ? 'opacity-50 cursor-not-allowed bg-[var(--ctp-surface-1)] border-[var(--ctp-overlay)]'
            : 'hover:border-[var(--ctp-mauve)] cursor-pointer bg-[var(--ctp-surface-1)] border-[var(--ctp-overlay)]'
        }`}
        style={{ borderColor: open ? currentRoleInfo.color : undefined }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: currentRoleInfo.color }}
        />
        {currentRoleInfo.label}
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />

          {/* Dropdown */}
          <div
            className="absolute right-0 mt-2 w-64 glass-card p-3 z-50 animate-scaleIn shadow-xl"
            role="listbox"
          >
            <div className="space-y-1">
              {(Object.keys(ROLE_INFO) as Role[]).map(role => {
                const info = ROLE_INFO[role]
                const isCurrentRole = role === value
                const canSelect = canChangeRole(role)

                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => {
                      if (canSelect) {
                        onChange(role)
                        setOpen(false)
                      }
                    }}
                    disabled={!canSelect}
                    className={`w-full text-left p-2 rounded-lg transition-all flex items-center gap-3 ${
                      isCurrentRole
                        ? 'bg-[var(--ctp-mauve-20)]'
                        : canSelect
                          ? 'hover:bg-[var(--ctp-surface-1)]'
                          : 'opacity-50 cursor-not-allowed'
                    }`}
                    role="option"
                    aria-selected={isCurrentRole}
                  >
                    {/* Radio indicator */}
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      isCurrentRole
                        ? 'border-[var(--ctp-mauve)]'
                        : 'border-[var(--ctp-overlay)]'
                    }`}>
                      {isCurrentRole && (
                        <div className="w-2 h-2 rounded-full bg-[var(--ctp-mauve)]" />
                      )}
                    </div>

                    {/* Role info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--ctp-text)]">
                          {info.label}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--ctp-subtext)] truncate">
                        {info.description}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Permissions reference */}
            <div className="mt-3 pt-3 border-t border-[var(--ctp-overlay)]/30">
              <p className="text-xs font-medium text-[var(--ctp-subtext)] mb-2">
                Permissions for {ROLE_INFO[value].label}:
              </p>
              <ul className="space-y-1">
                {ROLE_PERMISSIONS[value].map(permission => (
                  <li key={permission} className="flex items-center gap-2 text-xs text-[var(--ctp-text)]">
                    <svg className="w-3 h-3 text-[var(--ctp-green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                    {permission}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
