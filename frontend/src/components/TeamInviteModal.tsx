import { useState } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

interface TeamInviteModalProps {
  open: boolean
  onClose: () => void
  teamId: string
  teamName: string
  onInviteSent: () => void
}

interface InviteEntry {
  id: string
  email: string
  role: 'viewer' | 'editor' | 'admin'
}

const ROLE_DESCRIPTIONS = {
  viewer: {
    label: 'Viewer',
    color: 'var(--ctp-overlay)',
    description: 'Can view projects and watch clips',
    permissions: ['View projects', 'Watch clips'],
  },
  editor: {
    label: 'Editor',
    color: 'var(--ctp-green)',
    description: 'Can create and edit clips',
    permissions: ['View projects', 'Watch clips', 'Create clips', 'Edit clips', 'Render clips'],
  },
  admin: {
    label: 'Admin',
    color: 'var(--ctp-blue)',
    description: 'Can manage team members',
    permissions: ['View projects', 'Watch clips', 'Create clips', 'Edit clips', 'Render clips', 'Invite members', 'Remove members'],
  },
}

export function TeamInviteModal({ open, onClose, teamId, teamName, onInviteSent }: TeamInviteModalProps) {
  const [invites, setInvites] = useState<InviteEntry[]>([{ id: '1', email: '', role: 'editor' }])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPermissions, setShowPermissions] = useState(false)

  const addInviteEntry = () => {
    setInvites([...invites, { id: Date.now().toString(), email: '', role: 'editor' }])
  }

  const removeInviteEntry = (id: string) => {
    if (invites.length > 1) {
      setInvites(invites.filter(i => i.id !== id))
    }
  }

  const updateInviteEntry = (id: string, field: keyof InviteEntry, value: string) => {
    setInvites(invites.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validInvites = invites.filter(i => i.email.trim())
    if (validInvites.length === 0) return

    setIsSending(true)
    setError(null)

    try {
      // Send invites sequentially
      for (const invite of validInvites) {
        const res = await fetch(`/api/teams/${teamId}/invites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: invite.email.trim(), role: invite.role }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          throw new Error(err.detail || `Failed to invite ${invite.email}`)
        }
      }
      onInviteSent()
      onClose()
      setInvites([{ id: '1', email: '', role: 'editor' }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invites')
    } finally {
      setIsSending(false)
    }
  }

  const selectedRole = invites[0]?.role || 'editor'
  const roleInfo = ROLE_DESCRIPTIONS[selectedRole as keyof typeof ROLE_DESCRIPTIONS]

  return (
    <Modal open={open} onClose={onClose} title="Invite to Team">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-[var(--ctp-subtext)]">
          Invite members to join <span className="font-medium text-[var(--ctp-text)]">{teamName}</span>
        </p>

        {/* Email inputs */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-[var(--ctp-text)]">
            Email addresses
          </label>
          {invites.map((invite, index) => (
            <div key={invite.id} className="flex gap-2">
              <Input
                type="email"
                value={invite.email}
                onChange={(e) => updateInviteEntry(invite.id, 'email', e.target.value)}
                placeholder={`user${index + 1}@example.com`}
                className="flex-1"
              />
              <select
                value={invite.role}
                onChange={(e) => updateInviteEntry(invite.id, 'role', e.target.value as 'viewer' | 'editor' | 'admin')}
                className="glass-input px-3 py-2 text-sm min-w-[100px]"
                aria-label="Select role"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
              {invites.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeInviteEntry(invite.id)}
                  className="p-2 text-[var(--ctp-subtext)] hover:text-[var(--ctp-red)] transition-colors"
                  aria-label="Remove email"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={addInviteEntry}
            className="text-sm text-[var(--ctp-mauve)] hover:text-[var(--ctp-mauve)]/80 font-medium inline-flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add another email
          </button>
        </div>

        {/* Role permissions preview */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowPermissions(!showPermissions)}
            className="text-sm text-[var(--ctp-mauve)] hover:text-[var(--ctp-mauve)]/80 font-medium inline-flex items-center gap-1"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showPermissions ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            View role permissions
          </button>

          {showPermissions && (
            <div className="mt-3 p-4 rounded-lg bg-[var(--ctp-surface-1)] border border-[var(--ctp-overlay)] space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-xs px-2 py-0.5 rounded font-medium"
                  style={{
                    backgroundColor: `${roleInfo.color}20`,
                    color: roleInfo.color,
                    border: `1px solid ${roleInfo.color}40`
                  }}
                >
                  {roleInfo.label}
                </span>
                <span className="text-xs text-[var(--ctp-subtext)]">{roleInfo.description}</span>
              </div>
              <ul className="space-y-1">
                {roleInfo.permissions.map(permission => (
                  <li key={permission} className="flex items-center gap-2 text-xs text-[var(--ctp-text)]">
                    <svg className="w-3.5 h-3.5 text-[var(--ctp-green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                    {permission}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="p-3 rounded-lg bg-[var(--ctp-red-20)] border border-[var(--ctp-red-30)]">
            <p className="text-sm text-[var(--ctp-red)]">{error}</p>
          </div>
        )}

        {/* Submit buttons */}
        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            onClick={onClose}
            variant="secondary"
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={isSending}
            disabled={isSending || invites.every(i => !i.email.trim())}
            className="flex-1"
          >
            {isSending ? 'Sending...' : `Send Invite${invites.length > 1 ? 's' : ''}`}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
