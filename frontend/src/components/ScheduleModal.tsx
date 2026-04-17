import { useEffect, useState } from 'react'
import type { Clip } from '../types'
import type { PlatformAccount } from '../api'
import { schedulePost, getPlatformAccounts } from '../api'

// ---------------------------------------------------------------------------
// Metadata generation — enriches clip data into platform-ready post content
// ---------------------------------------------------------------------------

function generateDescription(clip: Clip): string {
  const reason = clip.reason
  const viralityLabel = clip.virality_score >= 80 ? 'absolute fire' : clip.virality_score >= 60 ? 'must-watch moment' : 'great clip'
  // Build a compelling description from the LLM reason + virality framing
  return `${reason.charAt(0).toUpperCase() + reason.slice(1)}. ${viralityLabel} 🎬`
}

function enrichHashtags(clip: Clip): string[] {
  const base = [...clip.hashtags]

  // Add brand-alignment derived tags for discovery
  const brandTags: Record<string, string[]> = {
    'gap moe': ['#GapMoe', '#VTuber', '#React', '#Gaming'],
    'gaming rage': ['#GamingRage', '#VTuber', '#Gaming', '#Reacts'],
    'cozy': ['#CozyVTuber', '#ChillVibes', '#VTuber'],
    'lore': ['#VTuberLore', '#StreamHighlights', '#VTuber'],
    'reaction': ['#VTuberReacts', '#Reacts', '#VTuber'],
    'clippable': ['#ClipCulture', '#VTuberClips', '#Shorts'],
  }

  const lowerReason = clip.reason.toLowerCase()
  for (const [keyword, tags] of Object.entries(brandTags)) {
    if (lowerReason.includes(keyword)) {
      for (const tag of tags) {
        if (!base.includes(tag)) base.push(tag)
      }
    }
  }

  // Add performance-based discovery tags
  if (clip.virality_score >= 80) {
    if (!base.includes('#Viral')) base.push('#Viral')
    if (!base.includes('#Trending')) base.push('#Trending')
  }

  // Cap at 20 hashtags (YouTube limit guidance)
  return base.slice(0, 20)
}

interface Props {
  clip: Clip
  clipKey: string
  videoPath: string
  platformAccounts: PlatformAccount[]
  onClose: () => void
  onScheduled: (jobId: string) => void
}

export function ScheduleModal({ clip, clipKey, videoPath, platformAccounts: initialAccounts, onClose, onScheduled }: Props) {
  const [platform, setPlatform] = useState('youtube')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [title, setTitle] = useState(clip.title)
  const [description, setDescription] = useState(() => generateDescription(clip))
  const [hashtags, setHashtags] = useState(() => enrichHashtags(clip).join(' '))
  const [privacy, setPrivacy] = useState('public')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<PlatformAccount[]>(initialAccounts ?? [])

  // Load all platform accounts when modal opens
  useEffect(() => {
    async function load() {
      try {
        const results = await Promise.all([
          getPlatformAccounts('youtube').catch(() => []),
          getPlatformAccounts('tiktok').catch(() => []),
          getPlatformAccounts('instagram').catch(() => []),
        ])
        setAccounts(results.flat())
      } catch { /* ignore */ }
    }
    load()
  }, [])

  const filteredAccounts = accounts.filter((a: PlatformAccount) => a.platform === platform)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!accountId) { setError('Please select an account.'); return }
    if (!date || !time) { setError('Please set a date and time.'); return }

    const scheduleAt = new Date(`${date}T${time}`).getTime() / 1000
    if (scheduleAt <= Date.now() / 1000) { setError('Schedule time must be in the future.'); return }

    setLoading(true)
    setError(null)
    try {
      const tagList = hashtags.split(/\s+/).filter(t => t.startsWith('#') || /^[a-zA-Z]/.test(t))
      const { job_id } = await schedulePost({
        clip_key: clipKey,
        video_path: videoPath,
        title,
        description,
        hashtags: tagList,
        platform,
        platform_account_id: accountId,
        schedule_at: scheduleAt,
        metadata: { privacy_status: privacy },
      })
      onScheduled(job_id)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-lg shadow-2xl border border-zinc-700">
        <h2 className="text-lg font-semibold text-white mb-4">Schedule Post</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Platform + Account */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Platform</label>
              <select
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-white text-sm"
                value={platform}
                onChange={e => { setPlatform(e.target.value); setAccountId('') }}
              >
                <option value="youtube">YouTube</option>
                <option value="tiktok">TikTok</option>
                <option value="instagram">Instagram</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Account</label>
              <select
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-white text-sm"
                value={accountId}
                onChange={e => setAccountId(e.target.value)}
                required
              >
                <option value="">Select account…</option>
                {filteredAccounts.map((a: PlatformAccount) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Schedule time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Date</label>
              <input
                type="date"
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-white text-sm"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Time</label>
              <input
                type="time"
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-white text-sm"
                value={time}
                onChange={e => setTime(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Title</label>
            <input
              type="text"
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-white text-sm"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Description</label>
            <textarea
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-white text-sm resize-none"
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          {/* Hashtags */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Hashtags (space-separated)</label>
            <input
              type="text"
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-white text-sm"
              value={hashtags}
              onChange={e => setHashtags(e.target.value)}
            />
          </div>

          {/* YouTube privacy */}
          {platform === 'youtube' && (
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Privacy</label>
              <select
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-white text-sm"
                value={privacy}
                onChange={e => setPrivacy(e.target.value)}
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              className="px-4 py-2 rounded text-zinc-400 hover:text-white hover:bg-zinc-700 text-sm"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm"
            >
              {loading ? 'Scheduling…' : 'Schedule Post'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
