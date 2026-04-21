import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { formatDate } from '../utils/format'
import { Modal } from '../components/ui/Modal'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import {
  updateProfile,
  changePassword,
  deleteAccount,
  sendTeamInvite,
  listTeamInvites,
  cancelTeamInvite,
  type TeamInvite,
} from '../api'

type Tab = 'profile' | 'password' | 'teams' | 'danger'

export function UserSettingsPage() {
  const navigate = useNavigate()
  const { user, isAuthenticated, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('profile')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Profile form state
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Team invite state
  const [invites, setInvites] = useState<TeamInvite[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('editor')
  const [inviteTeamId, setInviteTeamId] = useState('')
  const [userTeams, setUserTeams] = useState<{ id: string; name: string }[]>([])

  // Delete account modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true })
      return
    }
    loadUserData()
  }, [isAuthenticated])

  const loadUserData = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    try {
      // Load profile data
      setDisplayName(user.display_name || '')
      setEmail(user.email)

      // Load team invites
      try {
        const invitesData = await listTeamInvites()
        setInvites(invitesData)
      } catch {
        // Invites endpoint might not exist yet
      }

      // Load user's teams for invite dropdown
      try {
        const teamsRes = await fetch('/api/teams', { credentials: 'include' })
        if (teamsRes.ok) {
          const teamsData = await teamsRes.json()
          setUserTeams(teamsData.teams || [])
          if (teamsData.teams?.length > 0) {
            setInviteTeamId(teamsData.teams[0].id)
          }
        }
      } catch {
        // Teams endpoint might not exist yet
      }
    } catch (err) {
      console.error('Failed to load user data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      await updateProfile({
        email: email || undefined,
        display_name: displayName || undefined,
      })
      setSuccess('Profile updated successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      setLoading(false)
      return
    }

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters')
      setLoading(false)
      return
    }

    try {
      await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      })
      setSuccess('Password changed successfully')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setLoading(false)
    }
  }

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteTeamId) {
      setError('Please select a team')
      return
    }
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      await sendTeamInvite({
        team_id: inviteTeamId,
        email: inviteEmail,
        role: inviteRole,
      })
      setSuccess('Invite sent successfully')
      setInviteEmail('')
      // Refresh invites
      const invitesData = await listTeamInvites()
      setInvites(invitesData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite')
    } finally {
      setLoading(false)
    }
  }

  const handleCancelInvite = async (inviteId: string) => {
    try {
      await cancelTeamInvite(inviteId)
      setSuccess('Invite cancelled')
      const invitesData = await listTeamInvites()
      setInvites(invitesData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel invite')
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      setError('Please type DELETE to confirm')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await deleteAccount()
      logout()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account')
      setLoading(false)
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'profile',
      label: 'Profile',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      id: 'password',
      label: 'Password',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
    },
    {
      id: 'teams',
      label: 'Teams',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      id: 'danger',
      label: 'Danger Zone',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ),
    },
  ]

  if (loading && !user) {
    return <LoadingSpinner label="Loading settings..." />
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[var(--ctp-mauve)] to-[var(--ctp-blue)] flex items-center justify-center text-white font-bold text-2xl shadow-lg">
            {(user?.display_name || user?.email || 'U')[0].toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ctp-text)]">Settings</h1>
            <p className="text-sm text-[var(--ctp-subtext)]">{user?.email}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="glass-card p-2">
        <div className="flex gap-2 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-[var(--ctp-mauve-20)] text-[var(--ctp-mauve)]'
                  : 'text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface-1)]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 rounded-lg bg-[var(--ctp-red-20)] border border-[var(--ctp-red-30)]">
          <p className="text-sm text-[var(--ctp-red)]">{error}</p>
        </div>
      )}
      {success && (
        <div className="p-4 rounded-lg bg-[var(--ctp-green-20)] border border-[var(--ctp-green-30)]">
          <p className="text-sm text-[var(--ctp-green)]">{success}</p>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'profile' && (
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-[var(--ctp-text)] mb-6">Profile Settings</h2>
          <form onSubmit={handleUpdateProfile} className="space-y-4 max-w-md">
            <Input
              label="Display Name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your display name"
            />
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
            <Button type="submit" variant="primary" loading={loading} disabled={loading}>
              Save Changes
            </Button>
          </form>
        </div>
      )}

      {activeTab === 'password' && (
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-[var(--ctp-text)] mb-6">Change Password</h2>
          <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
            <Input
              label="Current Password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            <Input
              label="New Password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <Input
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
            <Button type="submit" variant="primary" loading={loading} disabled={loading}>
              Change Password
            </Button>
          </form>
        </div>
      )}

      {activeTab === 'teams' && (
        <div className="space-y-6">
          {/* Send Invite */}
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-[var(--ctp-text)] mb-6">Send Team Invite</h2>
            <form onSubmit={handleSendInvite} className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-[var(--ctp-text)] mb-1">
                  Team
                </label>
                <select
                  value={inviteTeamId}
                  onChange={(e) => setInviteTeamId(e.target.value)}
                  className="glass-input w-full px-3 py-2 text-sm"
                  disabled={userTeams.length === 0}
                >
                  {userTeams.length === 0 ? (
                    <option value="">No teams available</option>
                  ) : (
                    userTeams.map(team => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))
                  )}
                </select>
              </div>
              <Input
                label="Email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                required
              />
              <div>
                <label className="block text-sm font-medium text-[var(--ctp-text)] mb-1">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="glass-input w-full px-3 py-2 text-sm"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <Button type="submit" variant="primary" loading={loading} disabled={loading || userTeams.length === 0}>
                Send Invite
              </Button>
            </form>
          </div>

          {/* Pending Invites */}
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-[var(--ctp-text)] mb-6">Pending Invites</h2>
            {invites.length === 0 ? (
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
                        {invite.role} in {invite.team_name} &bull; Expires {formatDate(invite.expires_at || 0)}
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
        </div>
      )}

      {activeTab === 'danger' && (
        <div className="glass-card p-6 border-[var(--ctp-red-30)]">
          <h2 className="text-lg font-semibold text-[var(--ctp-red)] mb-6">Danger Zone</h2>
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-[var(--ctp-red-20)] border border-[var(--ctp-red-30)]">
              <h3 className="font-semibold text-[var(--ctp-text)] mb-2">Delete Account</h3>
              <p className="text-sm text-[var(--ctp-subtext)] mb-4">
                This action is irreversible. All your projects, clips, and data will be permanently deleted.
              </p>
              <Button
                onClick={() => setDeleteModalOpen(true)}
                variant="danger"
              >
                Delete Account
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => { setDeleteModalOpen(false); setDeleteConfirmText(''); setError(null) }}
        title="Delete Account"
      >
        <div className="space-y-4">
          <p className="text-[var(--ctp-subtext)]">
            This action is <strong className="text-[var(--ctp-red)]">permanent and irreversible</strong>.
            All your projects, clips, teams, and data will be deleted forever.
          </p>
          <Input
            label={`Type DELETE to confirm`}
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="DELETE"
          />
          <div className="flex gap-3 pt-4">
            <Button
              onClick={() => { setDeleteModalOpen(false); setDeleteConfirmText(''); setError(null) }}
              variant="secondary"
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteAccount}
              variant="danger"
              loading={loading}
              disabled={loading || deleteConfirmText !== 'DELETE'}
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
