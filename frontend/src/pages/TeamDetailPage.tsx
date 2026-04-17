import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { TeamMemberBadge } from '../components/ui/TeamMemberBadge'
import { RoleSelector } from '../components/RoleSelector'
import { TeamInviteModal } from '../components/TeamInviteModal'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'

interface TeamMember {
  id: string
  user_id: string
  user: {
    id: string
    display_name: string | null
    email: string
  }
  role: 'owner' | 'admin' | 'editor' | 'viewer'
}

interface TeamInvite {
  id: string
  invitee_email: string
  role: string
  status: 'pending' | 'accepted' | 'declined'
  expires_at: number
  inviter: {
    display_name: string | null
    email: string
  }
}

interface Team {
  id: string
  name: string
  owner_id: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  member_count: number
  project_count: number
  created_at: number
}

type Tab = 'members' | 'invites' | 'settings'

export function TeamDetailPage() {
  const { teamId } = useParams<{ teamId: string }>()
  const navigate = useNavigate()
  const { isAuthenticated, user } = useAuth()

  const [team, setTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<TeamInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<Tab>('members')
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [leaveModalOpen, setLeaveModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [teamNameConfirm, setTeamNameConfirm] = useState('')

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true })
      return
    }
    if (!teamId) return
    loadTeamData()
  }, [teamId, isAuthenticated])

  const loadTeamData = async () => {
    if (!teamId) return
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      // Load team info
      const teamRes = await fetch(`/api/teams/${teamId}`, { credentials: 'include' })
      if (teamRes.status === 403 || teamRes.status === 404) {
        setError('Team not found or access denied')
        setLoading(false)
        return
      }
      if (!teamRes.ok) throw new Error(await teamRes.text())
      const teamData = await teamRes.json()
      setTeam(teamData)

      // Load members
      const membersRes = await fetch(`/api/teams/${teamId}/members`, { credentials: 'include' })
      if (membersRes.ok) {
        const membersData = await membersRes.json()
        setMembers(membersData.members || [])
      }

      // Load invites (only for admins/owners)
      if (['owner', 'admin'].includes(teamData.role)) {
        const invitesRes = await fetch(`/api/teams/${teamId}/invites`, { credentials: 'include' })
        if (invitesRes.ok) {
          const invitesData = await invitesRes.json()
          setInvites(invitesData.invites || [])
        }
      }
    } catch (err) {
      console.error('Failed to load team data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load team')
    } finally {
      setLoading(false)
    }
  }

  const handleRoleChange = async (memberId: string, newRole: 'owner' | 'admin' | 'editor' | 'viewer') => {
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch(`/api/teams/${teamId}/members/${memberId}/role`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      if (!res.ok) throw new Error(await res.text())
      setSuccess(`Role updated to ${newRole}`)
      loadTeamData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role')
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm('Remove this member from the team?')) return

    setError(null)
    setSuccess(null)

    try {
      const res = await fetch(`/api/teams/${teamId}/members/${memberId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(await res.text())
      setSuccess('Member removed')
      loadTeamData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member')
    }
  }

  const handleCancelInvite = async (inviteId: string) => {
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch(`/api/teams/${teamId}/invites/${inviteId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(await res.text())
      setSuccess('Invite cancelled')
      loadTeamData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel invite')
    }
  }

  const handleLeaveTeam = async () => {
    if (!team || team.role === 'owner') return

    setError(null)
    setSuccess(null)

    try {
      const res = await fetch(`/api/teams/${teamId}/leave`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(await res.text())
      setLeaveModalOpen(false)
      navigate('/teams')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave team')
    }
  }

  const handleDeleteTeam = async () => {
    if (!team || team.role !== 'owner') return
    if (teamNameConfirm !== team.name) return

    setError(null)
    setSuccess(null)

    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(await res.text())
      setDeleteModalOpen(false)
      navigate('/teams')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete team')
    }
  }

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const canManageMembers = team && ['owner', 'admin'].includes(team.role)
  const isOwner = team?.role === 'owner'
  const isCurrentUser = (member: TeamMember) => member.user_id === user?.id

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="relative w-16 h-16 mx-auto">
            <div className="absolute inset-0 rounded-full border-4 border-[var(--ctp-mauve-20)]" />
            <div className="absolute inset-0 rounded-full border-4 border-[var(--ctp-mauve)] border-t-transparent animate-spin" />
          </div>
          <p className="text-[var(--ctp-subtext)] animate-pulse">Loading team...</p>
        </div>
      </div>
    )
  }

  if (error && !team) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="glass-card p-8 text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--ctp-red-20)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--ctp-red)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--ctp-text)] mb-2">Access Denied</h3>
          <p className="text-sm text-[var(--ctp-red)] mb-4">{error}</p>
          <Link to="/teams">
            <Button variant="primary">Back to Teams</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Link to="/teams" className="text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)] transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-[var(--ctp-text)]">{team?.name}</h1>
                {team && (
                  <span className={`text-xs px-2 py-1 rounded font-medium border ${
                    team.role === 'owner' ? 'bg-[var(--ctp-mauve-20)] text-[var(--ctp-mauve)] border-[var(--ctp-mauve-30)]' :
                    team.role === 'admin' ? 'bg-[var(--ctp-blue-20)] text-[var(--ctp-blue)] border-[var(--ctp-blue-30)]' :
                    team.role === 'editor' ? 'bg-[var(--ctp-green-20)] text-[var(--ctp-green)] border-[var(--ctp-green-30)]' :
                    'bg-[var(--ctp-overlay-20)] text-[var(--ctp-subtext)] border-[var(--ctp-overlay-30)]'
                  }`}>
                    {team.role.charAt(0).toUpperCase() + team.role.slice(1)}
                  </span>
                )}
              </div>
              <p className="text-sm text-[var(--ctp-subtext)] mt-1">
                {team?.member_count} members &bull; {team?.project_count} projects
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canManageMembers && (
              <Button onClick={() => setInviteModalOpen(true)} variant="primary" className="inline-flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
                Invite
              </Button>
            )}
            {isOwner ? (
              <Button onClick={() => setDeleteModalOpen(true)} variant="danger" size="sm">
                Delete Team
              </Button>
            ) : (
              <Button onClick={() => setLeaveModalOpen(true)} variant="secondary" size="sm">
                Leave Team
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 rounded-xl bg-[var(--ctp-red-20)] border border-[var(--ctp-red-30)]">
          <p className="text-sm text-[var(--ctp-red)]">{error}</p>
        </div>
      )}
      {success && (
        <div className="p-4 rounded-xl bg-[var(--ctp-green-20)] border border-[var(--ctp-green-30)]">
          <p className="text-sm text-[var(--ctp-green)]">{success}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="glass-card p-2">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('members')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'members'
                ? 'bg-[var(--ctp-mauve-20)] text-[var(--ctp-mauve)]'
                : 'text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface-1)]'
            }`}
          >
            Members ({members.length})
          </button>
          {canManageMembers && (
            <button
              onClick={() => setActiveTab('invites')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'invites'
                  ? 'bg-[var(--ctp-mauve-20)] text-[var(--ctp-mauve)]'
                  : 'text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface-1)]'
              }`}
            >
              Invites {invites.filter(i => i.status === 'pending').length > 0 && `(${invites.filter(i => i.status === 'pending').length})`}
            </button>
          )}
          {isOwner && (
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'settings'
                  ? 'bg-[var(--ctp-mauve-20)] text-[var(--ctp-mauve)]'
                  : 'text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface-1)]'
              }`}
            >
              Settings
            </button>
          )}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'members' && (
        <div className="glass-card p-6">
          <div className="space-y-4">
            {members.map(member => (
              <div
                key={member.id}
                className="flex items-center justify-between p-4 rounded-lg bg-[var(--ctp-surface-1)] border border-[var(--ctp-overlay)]"
              >
                <TeamMemberBadge
                  name={member.user.display_name || member.user.email}
                  email={member.user.display_name ? member.user.email : undefined}
                  role={member.role}
                  size="md"
                />
                <div className="flex items-center gap-3">
                  {canManageMembers && !isCurrentUser(member) ? (
                    <>
                      <RoleSelector
                        value={member.role}
                        onChange={(newRole) => handleRoleChange(member.id, newRole)}
                        currentRole={team?.role}
                      />
                      <button
                        onClick={() => handleRemoveMember(member.id)}
                        className="p-2 text-[var(--ctp-subtext)] hover:text-[var(--ctp-red)] transition-colors"
                        aria-label="Remove member"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-[var(--ctp-subtext)]">
                      {isCurrentUser(member) ? 'You' : member.role}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'invites' && canManageMembers && (
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-[var(--ctp-text)] mb-4">Pending Invites</h2>
          {invites.filter(i => i.status === 'pending').length === 0 ? (
            <p className="text-[var(--ctp-subtext)] text-sm">No pending invites</p>
          ) : (
            <div className="space-y-3">
              {invites.filter(i => i.status === 'pending').map(invite => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between p-4 rounded-lg bg-[var(--ctp-surface-1)] border border-[var(--ctp-overlay)]"
                >
                  <div>
                    <p className="font-medium text-[var(--ctp-text)]">{invite.invitee_email}</p>
                    <p className="text-xs text-[var(--ctp-subtext)]">
                      Invited as {invite.role} by {invite.inviter.display_name || invite.inviter.email}
                      &bull; Expires {formatDate(invite.expires_at)}
                    </p>
                  </div>
                  <Button
                    onClick={() => handleCancelInvite(invite.id)}
                    variant="ghost"
                    size="sm"
                  >
                    Cancel
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && isOwner && (
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-[var(--ctp-text)] mb-6">Team Settings</h2>
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-[var(--ctp-red-20)] border border-[var(--ctp-red-30)]">
              <h3 className="font-semibold text-[var(--ctp-text)] mb-2">Delete Team</h3>
              <p className="text-sm text-[var(--ctp-subtext)] mb-4">
                This action is irreversible. All team data, projects, and member access will be permanently deleted.
              </p>
              <Button onClick={() => setDeleteModalOpen(true)} variant="danger">
                Delete Team
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      <TeamInviteModal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        teamId={teamId!}
        teamName={team?.name || ''}
        onInviteSent={loadTeamData}
      />

      {/* Leave Team Modal */}
      <Modal
        open={leaveModalOpen}
        onClose={() => setLeaveModalOpen(false)}
        title="Leave Team"
      >
        <div className="space-y-4">
          <p className="text-[var(--ctp-subtext)]">
            Are you sure you want to leave <strong className="text-[var(--ctp-text)]">{team?.name}</strong>?
            You will lose access to all team projects and clips.
          </p>
          <div className="flex gap-3 pt-4">
            <Button onClick={() => setLeaveModalOpen(false)} variant="secondary" className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleLeaveTeam} variant="danger" className="flex-1">
              Leave Team
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Team Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => { setDeleteModalOpen(false); setTeamNameConfirm('') }}
        title="Delete Team"
      >
        <div className="space-y-4">
          <p className="text-[var(--ctp-subtext)]">
            This action is <strong className="text-[var(--ctp-red)]">permanent and irreversible</strong>.
            All team projects, clips, and member access will be deleted forever.
          </p>
          <Input
            label={`Type ${team?.name} to confirm`}
            type="text"
            value={teamNameConfirm}
            onChange={(e) => setTeamNameConfirm(e.target.value)}
            placeholder={team?.name || ''}
          />
          <div className="flex gap-3 pt-4">
            <Button
              onClick={() => { setDeleteModalOpen(false); setTeamNameConfirm('') }}
              variant="secondary"
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteTeam}
              variant="danger"
              disabled={teamNameConfirm !== team?.name}
              className="flex-1"
            >
              Delete Forever
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
