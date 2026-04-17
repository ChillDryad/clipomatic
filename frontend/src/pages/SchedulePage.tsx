import { useCallback, useEffect, useState } from 'react'
import { cancelJob, getJobStatus, getScheduleJobs, type PostJob } from '../api'

const PLATFORM_ICONS: Record<string, string> = {
  youtube: '▶',
  tiktok: '♪',
  instagram: '◉',
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending:    { label: 'Pending',    className: 'bg-zinc-600 text-zinc-200' },
  scheduled:  { label: 'Scheduled',  className: 'bg-blue-800 text-blue-200' },
  posted:     { label: 'Posted',     className: 'bg-green-800 text-green-200' },
  failed:     { label: 'Failed',     className: 'bg-red-800 text-red-200' },
  cancelled:  { label: 'Cancelled',  className: 'bg-zinc-700 text-zinc-400 line-through' },
}

function relativeTime(ts: number): string {
  const diff = ts - Date.now() / 1000
  if (diff < 60) return 'in < 1 min'
  if (diff < 3600) return `in ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `in ${Math.floor(diff / 3600)} h`
  return `in ${Math.floor(diff / 86400)} d`
}

function absoluteTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

interface Props {
  onScheduleClip?: (clipKey: string, videoPath: string, title: string, hashtags: string[]) => void
}

export function SchedulePage({ onScheduleClip }: Props) {
  const [jobs, setJobs] = useState<PostJob[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState<Set<string>>(new Set())

  async function load() {
    try {
      const data = await getScheduleJobs()
      setJobs(data)
    } catch (err) {
      console.error('Failed to load schedule:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Poll scheduled jobs for status updates
  useEffect(() => {
    const scheduled = jobs.filter(j => j.status === 'scheduled')
    if (scheduled.length === 0) return
    const interval = setInterval(async () => {
      await Promise.all(scheduled.map(async j => {
        try {
          const updated = await getJobStatus(j.id)
          setJobs(prev => prev.map(j => j.id === updated.id ? updated : j))
        } catch { /* ignore */ }
      }))
    }, 10_000)
    return () => clearInterval(interval)
  }, [jobs])

  const handleCancel = useCallback(async (jobId: string) => {
    setCancelling(prev => new Set(prev).add(jobId))
    try {
      await cancelJob(jobId)
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'cancelled' as const } : j))
    } finally {
      setCancelling(prev => { const s = new Set(prev); s.delete(jobId); return s })
    }
  }, [])

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Post Schedule</h1>
        <button
          className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
          onClick={() => {
            const clipKey = window.prompt('Enter clip_key (source_path___index):')
            const videoPath = window.prompt('Enter video_path:')
            if (clipKey && videoPath) {
              onScheduleClip?.(clipKey, videoPath, '', [])
            }
          }}
        >
          + Schedule Post
        </button>
      </div>

      {loading ? (
        <p className="text-zinc-400">Loading…</p>
      ) : jobs.length === 0 ? (
        <div className="bg-zinc-800 rounded-lg p-8 text-center border border-zinc-700">
          <p className="text-zinc-400">No scheduled posts yet.</p>
          <p className="text-zinc-500 text-sm mt-1">Render a clip and click "Schedule Post" to get started.</p>
        </div>
      ) : (
        <div className="bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-left text-zinc-400">
                <th className="px-4 py-3 font-medium">Platform</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Scheduled</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => {
                const badge = STATUS_BADGE[job.status] ?? STATUS_BADGE.pending
                return (
                  <tr key={job.id} className="border-b border-zinc-700/50 last:border-0 hover:bg-zinc-700/30">
                    <td className="px-4 py-3">
                      <span className="text-lg" title={job.platform}>{PLATFORM_ICONS[job.platform] ?? '?'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{job.title}</p>
                      {job.error_message && (
                        <p className="text-red-400 text-xs mt-1">{job.error_message}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-300">{relativeTime(job.schedule_at)}</p>
                      <p className="text-zinc-500 text-xs">{absoluteTime(job.schedule_at)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {(job.status === 'scheduled' || job.status === 'pending') && (
                        <button
                          className="text-xs px-2 py-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-700 disabled:opacity-50"
                          disabled={cancelling.has(job.id)}
                          onClick={() => handleCancel(job.id)}
                        >
                          {cancelling.has(job.id) ? 'Cancelling…' : 'Cancel'}
                        </button>
                      )}
                      {job.status === 'failed' && (
                        <button
                          className="text-xs px-2 py-1 rounded text-zinc-400 hover:text-yellow-400 hover:bg-zinc-700"
                          onClick={() => {/* TODO: retry */}}
                        >
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
