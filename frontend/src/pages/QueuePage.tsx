import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getPipelineJobs,
  cancelPipelineJob,
  retryPipelineJob,
  pausePipelineJob,
  resumePipelineJob,
  getPipelineQueueStatus,
  type PipelineJobApi,
} from '../api'

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  queued:    { label: 'Queued',    className: 'bg-zinc-600 text-zinc-200' },
  running:   { label: 'Running',   className: 'bg-blue-800 text-blue-200' },
  paused:    { label: 'Paused',    className: 'bg-yellow-800 text-yellow-200' },
  completed: { label: 'Completed', className: 'bg-green-800 text-green-200' },
  failed:    { label: 'Failed',    className: 'bg-red-800 text-red-200' },
  cancelled: { label: 'Cancelled', className: 'bg-zinc-700 text-zinc-400 line-through' },
}

function formatTime(ts: number | null): string {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString()
}

function ProgressBar({ value, label }: { value: number; label: string | null }) {
  const pct = Math.round(value * 100)
  return (
    <div className="w-full">
      <div className="h-1.5 rounded-full bg-zinc-700 overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {label && <span className="text-xs text-[var(--ctp-subtext)] mt-0.5 block">{label}</span>}
    </div>
  )
}

export function QueuePage() {
  const [jobs, setJobs] = useState<PipelineJobApi[]>([])
  const [loading, setLoading] = useState(true)
  const [queueStatus, setQueueStatus] = useState<{ queued: number; running: number } | null>(null)
  const [filter, setFilter] = useState<string>('')

  const load = useCallback(async () => {
    try {
      const [jobData, status] = await Promise.all([
        getPipelineJobs({ status: filter || undefined, limit: 50 }),
        getPipelineQueueStatus(),
      ])
      setJobs(jobData.jobs)
      setQueueStatus(status)
    } catch (err) {
      console.error('Failed to load queue:', err)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  // Auto-refresh while jobs are active
  useEffect(() => {
    const hasActive = jobs.some(j => j.status === 'running' || j.status === 'queued')
    if (!hasActive) return
    const interval = setInterval(load, 3000)
    return () => clearInterval(interval)
  }, [jobs, load])

  const handleCancel = async (jobId: string) => {
    await cancelPipelineJob(jobId)
    load()
  }

  const handleRetry = async (jobId: string) => {
    await retryPipelineJob(jobId)
    load()
  }

  const handlePause = async (jobId: string) => {
    await pausePipelineJob(jobId)
    load()
  }

  const handleResume = async (jobId: string) => {
    await resumePipelineJob(jobId)
    load()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[var(--ctp-subtext)]">Loading queue...</div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--ctp-text)]">Pipeline Queue</h1>
        {queueStatus && (
          <div className="flex gap-3 text-sm">
            <span className="text-blue-400">{queueStatus.running} running</span>
            <span className="text-zinc-400">{queueStatus.queued} queued</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {['', 'queued', 'running', 'completed', 'failed', 'cancelled'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              filter === s
                ? 'bg-blue-600 text-white'
                : 'glass-card hover:bg-zinc-700 text-[var(--ctp-subtext)]'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Job list */}
      {jobs.length === 0 ? (
        <div className="glass-card p-8 text-center text-[var(--ctp-subtext)]">
          No jobs {filter ? `with status "${filter}"` : 'in queue'}
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map(job => {
            const style = STATUS_STYLES[job.status] || STATUS_STYLES.queued
            return (
              <div key={job.id} className="glass-card p-4 space-y-3">
                {/* Top row: project link + status badge */}
                <div className="flex items-center justify-between">
                  <Link
                    to={`/video/${job.project_id}`}
                    className="text-sm font-medium text-[var(--ctp-text)] hover:text-blue-400 transition-colors"
                  >
                    Project {job.project_id.slice(0, 8)}...
                  </Link>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${style.className}`}>
                    {style.label}
                  </span>
                </div>

                {/* Steps indicator */}
                <div className="flex gap-1 text-xs">
                  {job.steps.map((step, i) => (
                    <span
                      key={step}
                      className={`px-2 py-0.5 rounded ${
                        i < job.current_step
                          ? 'bg-green-800 text-green-200'
                          : i === job.current_step && job.status === 'running'
                          ? 'bg-blue-800 text-blue-200'
                          : 'bg-zinc-700 text-zinc-400'
                      }`}
                    >
                      {step}
                    </span>
                  ))}
                </div>

                {/* Progress bar (running jobs) */}
                {(job.status === 'running' || job.status === 'paused') && (
                  <ProgressBar value={job.step_progress} label={job.step_label} />
                )}

                {/* Error message */}
                {job.error_message && (
                  <div className="text-xs text-red-400 bg-red-900/20 rounded p-2">
                    {job.error_message}
                  </div>
                )}

                {/* Metadata */}
                <div className="flex items-center justify-between text-xs text-[var(--ctp-subtext)]">
                  <span>Queued: {formatTime(job.queued_at)}</span>
                  {job.completed_at && <span>Done: {formatTime(job.completed_at)}</span>}
                  {job.retry_count > 0 && <span>Retries: {job.retry_count}</span>}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  {job.status === 'running' && (
                    <>
                      <button onClick={() => handlePause(job.id)} className="btn-ghost text-xs px-3 py-1">
                        Pause
                      </button>
                      <button onClick={() => handleCancel(job.id)} className="btn-ghost text-xs px-3 py-1 text-red-400">
                        Cancel
                      </button>
                    </>
                  )}
                  {job.status === 'queued' && (
                    <button onClick={() => handleCancel(job.id)} className="btn-ghost text-xs px-3 py-1 text-red-400">
                      Cancel
                    </button>
                  )}
                  {job.status === 'paused' && (
                    <button onClick={() => handleResume(job.id)} className="btn-ghost text-xs px-3 py-1 text-green-400">
                      Resume
                    </button>
                  )}
                  {job.status === 'failed' && (
                    <button onClick={() => handleRetry(job.id)} className="btn-ghost text-xs px-3 py-1 text-yellow-400">
                      Retry
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}