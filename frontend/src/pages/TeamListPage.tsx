import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { getRoleBadgeClass } from '../utils/roles'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'

interface Team {
  id: string
  name: string
  owner_id: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  member_count: number
  project_count: number
  created_at: number
}

export function TeamListPage() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true })
      return
    }
    loadTeams()
  }, [isAuthenticated])

  const loadTeams = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/teams', { credentials: 'include' })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setTeams(data.teams || [])
    } catch (err) {
      console.error('Failed to load teams:', err)
      setError(err instanceof Error ? err.message : 'Failed to load teams')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTeamName.trim()) return

    setIsCreating(true)
    setError(null)

    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTeamName.trim() }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setCreateModalOpen(false)
      setNewTeamName('')
      navigate(`/teams/${data.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create team')
    } finally {
      setIsCreating(false)
    }
  }


  const getTeamIcon = (team: Team) => {
    if (team.role === 'owner') return '🏠'
    if (team.role === 'admin') return '⚙️'
    if (team.project_count > 20) return '🎬'
    return '👥'
  }

  if (loading) {
    return <LoadingSpinner label="Loading teams..." />
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ctp-text)]">Teams</h1>
            <p className="text-sm text-[var(--ctp-subtext)] mt-1">
              Collaborate with others and share your projects
            </p>
          </div>
          <Button onClick={() => setCreateModalOpen(true)} variant="primary" className="inline-flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Team
          </Button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 rounded-xl bg-[var(--ctp-red-20)] border border-[var(--ctp-red-30)]">
          <p className="text-sm text-[var(--ctp-red)]">{error}</p>
        </div>
      )}

      {/* Teams Grid */}
      {teams.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[var(--ctp-mauve-20)] to-[var(--ctp-blue-20)] flex items-center justify-center">
            <svg className="w-10 h-10 text-[var(--ctp-mauve)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-[var(--ctp-text)] mb-2">No teams yet</h3>
          <p className="text-[var(--ctp-subtext)] mb-6 max-w-sm mx-auto">
            Create a team to collaborate with other creators and share your video projects
          </p>
          <Button onClick={() => setCreateModalOpen(true)} variant="primary" className="inline-flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Create Your First Team
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map(team => (
            <Link
              key={team.id}
              to={`/teams/${team.id}`}
              className="glass-card p-5 hover:border-[var(--ctp-mauve)] hover:shadow-lg transition-all duration-300 group cursor-pointer block"
            >
              {/* Team Icon */}
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--ctp-mauve-20)] to-[var(--ctp-blue-20)] flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">
                {getTeamIcon(team)}
              </div>

              {/* Team Info */}
              <h3 className="font-semibold text-[var(--ctp-text)] truncate mb-2 group-hover:text-[var(--ctp-mauve)] transition-colors">
                {team.name}
              </h3>

              {/* Role Badge */}
              <span className={`inline-block text-xs px-2 py-1 rounded font-medium border mb-3 ${getRoleBadgeClass(team.role)}`}>
                {team.role.charAt(0).toUpperCase() + team.role.slice(1)}
              </span>

              {/* Stats */}
              <div className="flex items-center justify-between text-xs text-[var(--ctp-subtext)]">
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  {team.member_count} {team.member_count === 1 ? 'member' : 'members'}
                </span>
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  {team.project_count} {team.project_count === 1 ? 'project' : 'projects'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create Team Modal */}
      <Modal
        open={createModalOpen}
        onClose={() => { setCreateModalOpen(false); setNewTeamName(''); setError(null) }}
        title="Create New Team"
      >
        <form onSubmit={handleCreateTeam} className="space-y-4">
          <p className="text-sm text-[var(--ctp-subtext)]">
            Create a team to collaborate with other creators and share your video projects.
          </p>

          <Input
            label="Team Name"
            type="text"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="My Awesome Team"
            required
            minLength={2}
            maxLength={50}
          />

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              onClick={() => { setCreateModalOpen(false); setNewTeamName(''); setError(null) }}
              variant="secondary"
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isCreating}
              disabled={isCreating || !newTeamName.trim()}
              className="flex-1"
            >
              Create Team
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
