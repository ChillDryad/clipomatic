import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { frameUrl } from '../api'

interface VideoProject {
  id: string
  owner_id: string
  team_id: string | null
  source_path: string
  original_filename: string
  duration: number | null
  status: 'pending' | 'processing' | 'complete' | 'failed'
  created_at: number
  updated_at: number
  clip_count?: number
}

interface Team {
  id: string
  name: string
  owner_id: string
  member_count?: number
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { user, isAuthenticated, logout } = useAuth()
  const [projects, setProjects] = useState<VideoProject[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true })
      return
    }
    loadDashboard()
  }, [selectedTeam, isAuthenticated])

  const loadDashboard = async () => {
    setLoading(true)
    setError(null)

    try {
      // Load teams
      const teamsRes = await fetch('/api/teams', { credentials: 'include' })
      if (teamsRes.ok) {
        const teamsData = await teamsRes.json()
        setTeams(teamsData.teams || [])
      }

      // Load projects
      const projectsUrl = selectedTeam
        ? `/api/projects?team_id=${selectedTeam}`
        : '/api/projects'
      const projectsRes = await fetch(projectsUrl, { credentials: 'include' })
      if (projectsRes.ok) {
        const projectsData = await projectsRes.json()
        setProjects(projectsData.projects || projectsData)
      }
    } catch (err) {
      console.error('Failed to load dashboard:', err)
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const formatDuration = (seconds: number | null): string => {
    if (seconds === null) return 'Unknown'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}h ${m}m ${s}s`
    return `${m}m ${s}s`
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="relative w-16 h-16 mx-auto">
            <div className="absolute inset-0 rounded-full border-4 border-[var(--ctp-mauve-20)]" />
            <div className="absolute inset-0 rounded-full border-4 border-[var(--ctp-mauve)] border-t-transparent animate-spin" />
          </div>
          <p className="text-[var(--ctp-subtext)] animate-pulse">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="glass-card p-8 text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--ctp-red-20)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--ctp-red)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--ctp-text)] mb-2">Failed to load dashboard</h3>
          <p className="text-sm text-[var(--ctp-red)] mb-6">{error}</p>
          <Button onClick={loadDashboard} variant="primary" className="inline-flex">
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            {/* User avatar */}
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--ctp-mauve)] to-[var(--ctp-blue)] flex items-center justify-center text-white font-bold text-lg shadow-lg">
              {(user?.display_name || user?.email || 'U')[0].toUpperCase()}
            </div>
            <div>
              <h1 className="text-xl font-bold text-[var(--ctp-text)]">Dashboard</h1>
              <p className="text-sm text-[var(--ctp-subtext)]">
                Welcome back, <span className="font-medium text-[var(--ctp-text)]">{user?.display_name || user?.email?.split('@')[0]}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/pipeline" className="btn-primary inline-flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Project
            </Link>
            <Button onClick={handleLogout} variant="secondary" size="sm" className="hidden sm:inline-flex">
              Logout
            </Button>
          </div>
        </div>
      </div>

      {/* Team Switcher */}
      {teams.length > 0 && (
        <div className="glass-card p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-[var(--ctp-mauve)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <h2 className="text-sm font-semibold text-[var(--ctp-text)]">Viewing</h2>
            </div>
            <div className="relative">
              <button
                onClick={() => setTeamDropdownOpen(!teamDropdownOpen)}
                className="btn-secondary text-sm flex items-center gap-2 py-2 px-4 hover:border-[var(--ctp-mauve)] transition-colors"
                aria-expanded={teamDropdownOpen}
                aria-haspopup="listbox"
              >
                <span className="max-w-[150px] truncate">
                  {selectedTeam
                    ? teams.find(t => t.id === selectedTeam)?.name
                    : 'All Projects'}
                </span>
                <svg className={`w-4 h-4 transition-transform ${teamDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {teamDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setTeamDropdownOpen(false)} />
                  <div className="absolute right-0 mt-2 w-56 glass-card py-1 z-50 animate-fadeIn shadow-xl" role="listbox">
                    <button
                      onClick={() => { setSelectedTeam(null); setTeamDropdownOpen(false) }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-3 ${!selectedTeam ? 'bg-[var(--ctp-mauve-20)] text-[var(--ctp-mauve)]' : 'text-[var(--ctp-text)] hover:bg-[var(--ctp-surface-1)]'}`}
                      role="option"
                      aria-selected={!selectedTeam}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                      All Projects
                    </button>
                    {teams.map(team => (
                      <button
                        key={team.id}
                        onClick={() => { setSelectedTeam(team.id); setTeamDropdownOpen(false) }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-3 ${selectedTeam === team.id ? 'bg-[var(--ctp-mauve-20)] text-[var(--ctp-mauve)]' : 'text-[var(--ctp-text)] hover:bg-[var(--ctp-surface-1)]'}`}
                        role="option"
                        aria-selected={selectedTeam === team.id}
                      >
                        <div className="w-4 h-4 rounded-full bg-[var(--ctp-mauve)]/20 flex items-center justify-center">
                          {selectedTeam === team.id && (
                            <svg className="w-3 h-3 text-[var(--ctp-mauve)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        {team.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Projects Grid */}
      <div>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-lg font-semibold text-[var(--ctp-text)] flex items-center gap-2">
            <svg className="w-5 h-5 text-[var(--ctp-mauve)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            {selectedTeam ? `${teams.find(t => t.id === selectedTeam)?.name} Projects` : 'My Projects'}
          </h2>
          <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--ctp-mauve-20)] text-[var(--ctp-mauve)] font-medium">
            {projects.length} project{projects.length !== 1 ? 's' : ''}
          </span>
        </div>

        {projects.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[var(--ctp-mauve-20)] to-[var(--ctp-blue-20)] flex items-center justify-center">
              <svg className="w-10 h-10 text-[var(--ctp-mauve)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-[var(--ctp-text)] mb-2">No projects yet</h3>
            <p className="text-[var(--ctp-subtext)] mb-6 max-w-sm mx-auto">
              Upload a video or paste a URL to create your first project and start generating clips
            </p>
            <Link to="/pipeline" className="btn-primary inline-flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Start Your First Project
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(project => (
              <Link
                key={project.id}
                to={`/video/${project.id}`}
                className="glass-card p-4 hover:border-[var(--ctp-mauve)] hover:shadow-lg transition-all duration-300 group cursor-pointer block"
              >
                {/* Thumbnail */}
                <div className="relative w-full rounded-xl overflow-hidden mb-3 bg-[var(--ctp-surface-1)] aspect-video">
                  <img
                    src={frameUrl(project.source_path, 2)}
                    alt={project.original_filename}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  {/* Duration badge */}
                  <span className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-md font-medium shadow-lg">
                    {formatDuration(project.duration)}
                  </span>
                  {/* Status indicator */}
                  <span className={`absolute top-2 left-2 text-[10px] px-2 py-1 rounded-full font-semibold shadow-lg backdrop-blur-sm ${
                    project.status === 'complete' ? 'bg-[var(--ctp-green)]/90 text-white' :
                    project.status === 'processing' ? 'bg-[var(--ctp-blue)]/90 text-white animate-pulse' :
                    project.status === 'failed' ? 'bg-[var(--ctp-red)]/90 text-white' :
                    'bg-[var(--ctp-overlay)]/90 text-white'
                  }`}>
                    {project.status === 'processing' && (
                      <svg className="inline w-3 h-3 mr-1 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {project.status}
                  </span>
                </div>

                {/* Info */}
                <h3 className="font-semibold text-[var(--ctp-text)] truncate mb-2 group-hover:text-[var(--ctp-mauve)] transition-colors">
                  {project.original_filename}
                </h3>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-[var(--ctp-subtext)]">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {project.clip_count || 0} clips
                  </span>
                  <span className="text-[var(--ctp-subtext)] flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {formatDate(project.created_at)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-5 group hover:border-[var(--ctp-mauve)] transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--ctp-mauve-20)] to-[var(--ctp-mauve-30)] flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg className="w-5 h-5 text-[var(--ctp-mauve)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div className="text-2xl font-bold text-[var(--ctp-mauve)]">{projects.length}</div>
          </div>
          <div className="text-xs text-[var(--ctp-subtext)] font-medium">Total Projects</div>
        </div>
        <div className="glass-card p-5 group hover:border-[var(--ctp-green)] transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--ctp-green-20)] to-[var(--ctp-green-30)] flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg className="w-5 h-5 text-[var(--ctp-green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-2xl font-bold text-[var(--ctp-green)]">
              {projects.filter(p => p.status === 'complete').length}
            </div>
          </div>
          <div className="text-xs text-[var(--ctp-subtext)] font-medium">Completed</div>
        </div>
        <div className="glass-card p-5 group hover:border-[var(--ctp-blue)] transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--ctp-blue-20)] to-[var(--ctp-blue-30)] flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg className="w-5 h-5 text-[var(--ctp-blue)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="text-2xl font-bold text-[var(--ctp-blue)]">
              {projects.filter(p => p.status === 'processing').length}
            </div>
          </div>
          <div className="text-xs text-[var(--ctp-subtext)] font-medium">Processing</div>
        </div>
        <div className="glass-card p-5 group hover:border-[var(--ctp-yellow)] transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--ctp-yellow-20)] to-[var(--ctp-yellow-30)] flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg className="w-5 h-5 text-[var(--ctp-yellow)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div className="text-2xl font-bold text-[var(--ctp-yellow)]">{teams.length}</div>
          </div>
          <div className="text-xs text-[var(--ctp-subtext)] font-medium">Teams</div>
        </div>
      </div>
    </div>
  )
}
