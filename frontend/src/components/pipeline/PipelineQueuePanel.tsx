import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getPipelineJobs, type PipelineJobApi } from '../../api'

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-zinc-500',
  running: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  paused: 'bg-yellow-500',
  cancelled: 'bg-zinc-600',
}

export function PipelineQueuePanel() {
  const [jobs, setJobs] = useState<PipelineJobApi[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const result = await getPipelineJobs({ limit: 10 })
        setJobs(result.jobs.filter(j => j.status === 'running' || j.status === 'queued'))
      } catch { /* ignore */ }
    }
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  if (jobs.length === 0 && !expanded) return null

  return (
    <div className="glass-card rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between text-sm text-[var(--ctp-text)]"
      >
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          Pipeline Queue
          <span className="text-xs text-[var(--ctp-subtext)]">({jobs.length})</span>
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 max-h-60 overflow-y-auto">
          {jobs.length === 0 ? (
            <p className="text-xs text-[var(--ctp-subtext)]">No active jobs</p>
          ) : (
            jobs.map(job => (
              <div key={job.id} className="flex items-center gap-2 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[job.status] || 'bg-zinc-500'}`} />
                <span className="text-[var(--ctp-text)] truncate">
                  {job.steps[job.current_step] || job.steps[0]}
                </span>
                {job.status === 'running' && (
                  <div className="flex-1 h-1 bg-zinc-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.round(job.step_progress * 100)}%` }} />
                  </div>
                )}
              </div>
            ))
          )}
          <Link to="/queue" className="block text-xs text-blue-400 hover:text-blue-300 mt-1">
            View full queue →
          </Link>
        </div>
      )}
    </div>
  )
}