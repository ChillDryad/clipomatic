import { useCallback, useEffect, useState } from 'react'
import {
  approveAgentPairing,
  createApiKey,
  getAgentInfo,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  type AgentInfo,
  type ApiKeyInfo,
} from '../../api'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

function displayDate(timestamp: number | null) {
  if (!timestamp) return 'Never'
  return new Date(timestamp * 1000).toLocaleString()
}

export function AgentAccessSection() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([])
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null)
  const [deviceCode, setDeviceCode] = useState('')
  const [keyLabel, setKeyLabel] = useState('')
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>('load')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const refreshKeys = useCallback(async () => {
    const result = await listApiKeys()
    setKeys(result)
  }, [])

  useEffect(() => {
    Promise.allSettled([refreshKeys(), getAgentInfo()])
      .then(results => {
        const infoResult = results[1]
        if (infoResult.status === 'fulfilled') setAgentInfo(infoResult.value)
        if (results[0].status === 'rejected') {
          setError('Could not load API keys. Agent access may not be enabled on this server.')
        }
      })
      .finally(() => setBusyAction(null))
  }, [refreshKeys])

  const runAction = async (action: string, work: () => Promise<void>) => {
    setBusyAction(action)
    setError(null)
    setSuccess(null)
    try {
      await work()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent access request failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handleApprove = (event: React.FormEvent) => {
    event.preventDefault()
    const normalizedCode = deviceCode.trim().toUpperCase()
    if (!normalizedCode) return
    void runAction('approve', async () => {
      await approveAgentPairing(normalizedCode)
      setDeviceCode('')
      setSuccess('Device approved. The agent can now exchange its device code for a token.')
      await refreshKeys()
    })
  }

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault()
    const label = keyLabel.trim()
    if (!label) return
    void runAction('create', async () => {
      const result = await createApiKey(label)
      setOneTimeToken(result.key)
      setKeyLabel('')
      await refreshKeys()
    })
  }

  const handleRotate = (key: ApiKeyInfo) => {
    if (!window.confirm(`Rotate “${key.label}”? Its current token will stop working immediately.`)) return
    void runAction(`rotate:${key.id}`, async () => {
      const result = await rotateApiKey(key.id)
      setOneTimeToken(result.key)
      await refreshKeys()
    })
  }

  const handleRevoke = (key: ApiKeyInfo) => {
    if (!window.confirm(`Revoke “${key.label}”? This cannot be undone.`)) return
    void runAction(`revoke:${key.id}`, async () => {
      await revokeApiKey(key.id)
      setSuccess(`Revoked ${key.label}`)
      await refreshKeys()
    })
  }

  const copyToken = async () => {
    if (!oneTimeToken) return
    await navigator.clipboard.writeText(oneTimeToken)
    setSuccess('Token copied to clipboard')
  }

  return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ctp-text)]">Agent Access</h2>
            <p className="text-sm text-[var(--ctp-subtext)] mt-1">
              Approve agent devices and manage tokens used by CLIs, automations, and integrations.
            </p>
          </div>
          {agentInfo && (
            <span className="text-xs text-[var(--ctp-subtext)] rounded-full bg-[var(--ctp-surface-1)] px-3 py-1">
              {agentInfo.name}{agentInfo.version ? ` ${agentInfo.version}` : ''}
            </span>
          )}
        </div>

        {error && <p role="alert" className="mb-4 text-sm text-[var(--ctp-red)]">{error}</p>}
        {success && <p role="status" className="mb-4 text-sm text-[var(--ctp-green)]">{success}</p>}

        {oneTimeToken && (
          <div className="mb-6 p-4 rounded-lg border border-[var(--ctp-yellow-30)] bg-[var(--ctp-yellow-10)]">
            <p className="font-semibold text-[var(--ctp-text)]">Save this token now</p>
            <p className="text-xs text-[var(--ctp-subtext)] mt-1 mb-3">
              For your security, this token is shown only once. Store it in a secret manager; do not share it.
            </p>
            <code className="block p-3 rounded bg-[var(--ctp-base)] text-sm text-[var(--ctp-text)] break-all select-all">
              {oneTimeToken}
            </code>
            <div className="flex gap-2 mt-3">
              <Button type="button" size="sm" onClick={copyToken}>Copy token</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setOneTimeToken(null)}>
                I saved it
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <form onSubmit={handleApprove} className="p-4 rounded-lg bg-[var(--ctp-surface-1)] space-y-3">
            <div>
              <h3 className="font-semibold text-[var(--ctp-text)]">Approve a device</h3>
              <p className="text-xs text-[var(--ctp-subtext)] mt-1">
                Enter the one-time code shown by the agent. Only approve devices you recognize.
              </p>
            </div>
            <Input
              label="Device code"
              value={deviceCode}
              onChange={event => setDeviceCode(event.target.value)}
              placeholder="ABCD-EFGH"
              autoComplete="off"
              spellCheck={false}
              required
            />
            <Button type="submit" loading={busyAction === 'approve'} disabled={!deviceCode.trim()}>
              Approve device
            </Button>
          </form>

          <form onSubmit={handleCreate} className="p-4 rounded-lg bg-[var(--ctp-surface-1)] space-y-3">
            <div>
              <h3 className="font-semibold text-[var(--ctp-text)]">Create a token</h3>
              <p className="text-xs text-[var(--ctp-subtext)] mt-1">
                Use a descriptive label so the token can be identified and revoked later.
              </p>
            </div>
            <Input
              label="Token label"
              value={keyLabel}
              onChange={event => setKeyLabel(event.target.value)}
              placeholder="Editing agent on MacBook"
              required
            />
            <Button type="submit" loading={busyAction === 'create'} disabled={!keyLabel.trim()}>
              Create token
            </Button>
          </form>
        </div>
      </div>

      <div className="glass-card p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-[var(--ctp-text)]">API keys</h2>
          <Button type="button" size="sm" variant="ghost" onClick={() => void runAction('refresh', refreshKeys)} loading={busyAction === 'refresh'}>
            Refresh
          </Button>
        </div>
        {busyAction === 'load' ? (
          <p className="text-sm text-[var(--ctp-subtext)]">Loading keys…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-[var(--ctp-subtext)]">No API keys yet.</p>
        ) : (
          <div className="space-y-3">
            {keys.map(key => (
              <div key={key.id} className="p-4 rounded-lg border border-[var(--ctp-overlay)] bg-[var(--ctp-surface-1)] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-[var(--ctp-text)] truncate">{key.label}</p>
                    <span className={`text-xs ${key.is_active ? 'text-[var(--ctp-green)]' : 'text-[var(--ctp-subtext)]'}`}>
                      {key.is_active ? 'Active' : 'Revoked'}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--ctp-subtext)] mt-1">
                    <code>{key.key_prefix}…</code> · Created {displayDate(key.created_at)} · Last used {displayDate(key.last_used_at)}
                  </p>
                  {key.expires_at && <p className="text-xs text-[var(--ctp-subtext)]">Expires {displayDate(key.expires_at)}</p>}
                </div>
                {key.is_active && (
                  <div className="flex gap-2 shrink-0">
                    <Button type="button" size="sm" variant="secondary" onClick={() => handleRotate(key)} loading={busyAction === `rotate:${key.id}`}>
                      Rotate
                    </Button>
                    <Button type="button" size="sm" variant="danger" onClick={() => handleRevoke(key)} loading={busyAction === `revoke:${key.id}`}>
                      Revoke
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
