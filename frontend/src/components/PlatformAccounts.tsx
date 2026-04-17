import { useEffect, useState } from 'react'
import { disconnectAccount, getPlatformAccounts, platformOAuthAuthorizeUrl, type PlatformAccount } from '../api'

interface Props {
  onAccountsChanged?: () => void
}

const PLATFORMS = ['youtube', 'tiktok', 'instagram'] as const

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
}

export function PlatformAccounts({ onAccountsChanged }: Props) {
  const [accounts, setAccounts] = useState<PlatformAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const results = await Promise.all(PLATFORMS.map(p => getPlatformAccounts(p).catch(() => [])))
      setAccounts(results.flat())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleDisconnect(platform: string, accountId: string) {
    setDisconnecting(accountId)
    try {
      await disconnectAccount(platform, accountId)
      await load()
      onAccountsChanged?.()
    } finally {
      setDisconnecting(null)
    }
  }

  function handleConnect(platform: string) {
    const url = platformOAuthAuthorizeUrl(platform)
    const label = prompt(`Enter a label for this ${PLATFORM_LABELS[platform]} account:`)
    if (!label) return
    window.open(`${url}?label=${encodeURIComponent(label)}`, '_blank')
  }

  return (
    <div className="space-y-4">
      {PLATFORMS.map(platform => {
        const platformAccounts = accounts.filter(a => a.platform === platform)
        return (
          <div key={platform} className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-medium">{PLATFORM_LABELS[platform]}</h3>
              <button
                className="text-xs px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white"
                onClick={() => handleConnect(platform)}
              >
                Connect {PLATFORM_LABELS[platform]}
              </button>
            </div>

            {loading ? (
              <p className="text-zinc-500 text-sm">Loading…</p>
            ) : platformAccounts.length === 0 ? (
              <p className="text-zinc-500 text-sm">No accounts connected.</p>
            ) : (
              <ul className="space-y-2">
                {platformAccounts.map(a => (
                  <li key={a.id} className="flex items-center justify-between bg-zinc-700 rounded px-3 py-2">
                    <div>
                      <p className="text-white text-sm font-medium">{a.label}</p>
                      {a.account_id && (
                        <p className="text-zinc-400 text-xs">{a.account_id}</p>
                      )}
                    </div>
                    <button
                      className="text-xs px-2 py-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-600"
                      disabled={disconnecting === a.id}
                      onClick={() => handleDisconnect(platform, a.id)}
                    >
                      {disconnecting === a.id ? 'Removing…' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
