import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

interface User {
  id: string
  email: string
  display_name?: string
  avatar_url?: string
}

interface HeaderProps {
  user: User
}

export function Header({ user }: HeaderProps) {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const initials = (user.display_name || user.email)
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <header className="glass-navbar fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-4 md:px-6">
      {/* Logo */}
      <Link to="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
        <span className="text-lg font-bold text-[var(--ctp-mauve)]">Momiji Clipper</span>
      </Link>

      {/* Right actions */}
      <div className="ml-auto flex items-center gap-3">
        {/* Dashboard link */}
        <Link
          to="/dashboard"
          className="btn-ghost text-sm hidden sm:inline-flex"
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          Dashboard
        </Link>

        {/* User menu */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--ctp-overlay)]/20 transition-colors"
            aria-label="User menu"
            aria-expanded={dropdownOpen}
          >
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-[var(--ctp-mauve)] text-[var(--ctp-base)] flex items-center justify-center text-sm font-semibold overflow-hidden">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={user.display_name || user.email} className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </div>

            {/* Email/name */}
            <div className="hidden md:block text-left">
              <p className="text-xs font-medium text-[var(--ctp-text)]">
                {user.display_name || user.email.split('@')[0]}
              </p>
              <p className="text-[10px] text-[var(--ctp-subtext)] truncate max-w-[120px]">
                {user.email}
              </p>
            </div>

            {/* Chevron */}
            <svg
              className={`w-4 h-4 text-[var(--ctp-subtext)] transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Dropdown menu */}
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-56 glass-card p-2 animate-fadeIn">
              {/* User info (mobile) */}
              <div className="md:hidden px-3 py-2 border-b border-[var(--glass-input-border)] mb-1">
                <p className="text-sm font-medium text-[var(--ctp-text)]">
                  {user.display_name || user.email.split('@')[0]}
                </p>
                <p className="text-xs text-[var(--ctp-subtext)] truncate">
                  {user.email}
                </p>
              </div>

              {/* Menu items */}
              <nav className="py-1">
                <Link
                  to="/dashboard"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--ctp-text)] hover:bg-[var(--ctp-overlay)]/20 rounded-lg transition-colors"
                  onClick={() => setDropdownOpen(false)}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  Dashboard
                </Link>

                <Link
                  to="/settings"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--ctp-text)] hover:bg-[var(--ctp-overlay)]/20 rounded-lg transition-colors"
                  onClick={() => setDropdownOpen(false)}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </Link>
              </nav>

              {/* Divider */}
              <div className="my-1 border-t border-[var(--glass-input-border)]" />

              {/* Logout */}
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--ctp-red)] hover:bg-[var(--ctp-red)]/10 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
