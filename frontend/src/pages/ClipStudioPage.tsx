/**
 * Clip Studio Page — Batch process videos for clip finding at source quality.
 *
 * Workflow:
 * 1. Select multiple video projects to process
 * 2. Pipeline runs: transcribe → highlights → export segments at source quality
 * 3. Browse exported clips with metadata, download links
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  batchProcessVideosForClips,
  cancelClipStudioQueue,
  listClipStudioQueue,
  listProjects,
  type ClipStudioQueueItem,
  type VideoProject,
} from '../api'

export default function ClipStudioPage() {
  const [projects, setProjects] = useState<VideoProject[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [queue, setQueue] = useState<ClipStudioQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [exportQuality, setExportQuality] = useState('source')
  const [exportFormat, setExportFormat] = useState('mp4')
  const [includeMetadata, setIncludeMetadata] = useState(true)
  const [generateEdl, setGenerateEdl] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [projectsRes, queueRes] = await Promise.all([
        listProjects(undefined, 200),
        listClipStudioQueue({ limit: 50 }),
      ])
      setProjects(projectsRes.projects || [])
      setQueue(queueRes.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 5000)
    return () => clearInterval(interval)
  }, [loadData])

  const toggleProject = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleEnqueue = async () => {
    if (selected.size === 0) return
    setError(null)
    setSuccess(null)
    try {
      const result = await batchProcessVideosForClips(Array.from(selected), {
        export_quality: exportQuality,
        export_format: exportFormat,
        include_metadata: includeMetadata,
        generate_edl: generateEdl,
      })
      setSuccess(`Queued ${result.queued} project(s) for Clip Studio processing`)
      setSelected(new Set())
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enqueue')
    }
  }

  const handleCancel = async (queueId: string) => {
    try {
      await cancelClipStudioQueue(queueId)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel')
    }
  }

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const formatTime = (ts: number | null) => {
    if (!ts) return '—'
    return new Date(ts * 1000).toLocaleTimeString()
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-400'
      case 'processing': return 'text-blue-400'
      case 'queued': return 'text-yellow-400'
      case 'failed': return 'text-red-400'
      case 'cancelled': return 'text-gray-400'
      default: return 'text-gray-400'
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen text-gray-400">Loading…</div>
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Clip Studio</h1>
      <p className="text-gray-400 mb-6">
        The source-quality default: batch process videos through transcribe → detect highlights → export.
        Clips keep their source quality and resolution — no re-encoding and no subtitles burned in.
        Legacy vertical rendering with burned-in subtitles remains available as an opt-in workflow.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded text-red-200 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-950 border border-green-800 rounded text-green-200 text-sm">
          {success}
        </div>
      )}

      {/* Settings */}
      <div className="mb-6 p-4 bg-gray-900 rounded-lg border border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Export Settings</h2>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Quality</span>
            <select
              value={exportQuality}
              onChange={e => setExportQuality(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
            >
              <option value="source">Source (stream copy — zero loss)</option>
              <option value="visually_lossless">Visually Lossless (CRF 12)</option>
              <option value="high">High (CRF 18)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Format</span>
            <select
              value={exportFormat}
              onChange={e => setExportFormat(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
            >
              <option value="mp4">MP4</option>
              <option value="mov">MOV</option>
              <option value="mkv">MKV</option>
            </select>
          </label>
          <label className="flex items-center gap-2 mt-5">
            <input
              type="checkbox"
              checked={includeMetadata}
              onChange={e => setIncludeMetadata(e.target.checked)}
              className="accent-blue-500"
            />
            <span className="text-sm text-gray-300">Include metadata JSON</span>
          </label>
          <label className="flex items-center gap-2 mt-5">
            <input
              type="checkbox"
              checked={generateEdl}
              onChange={e => setGenerateEdl(e.target.checked)}
              className="accent-blue-500"
            />
            <span className="text-sm text-gray-300">Generate EDL (DaVinci/Premiere)</span>
          </label>
        </div>
      </div>

      {/* Project selection */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-300">
            Select Videos ({selected.size} selected)
          </h2>
          <div className="flex items-center gap-2">
            <Link
              to="/pipeline"
              className="px-4 py-1.5 border border-gray-700 hover:border-gray-500 rounded text-sm font-medium transition"
            >
              Import a source
            </Link>
            <button
              onClick={handleEnqueue}
              disabled={selected.size === 0}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium transition"
            >
              Process {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        </div>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {projects.map(project => (
            <label
              key={project.id}
              className="flex items-center gap-3 p-2 hover:bg-gray-900 rounded cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(project.id)}
                onChange={() => toggleProject(project.id)}
                className="accent-blue-500"
              />
              <span className="text-sm text-gray-200 truncate flex-1">
                {project.original_filename || project.source_path}
              </span>
              <span className={`text-xs ${statusColor(project.status)}`}>{project.status}</span>
              {project.duration && (
                <span className="text-xs text-gray-500">
                  {Math.floor(project.duration / 60)}:{String(Math.floor(project.duration % 60)).padStart(2, '0')}
                </span>
              )}
            </label>
          ))}
          {projects.length === 0 && (
            <p className="text-gray-500 text-sm p-4 text-center">No projects available</p>
          )}
        </div>
      </div>

      {/* Queue */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Processing Queue</h2>
        <div className="space-y-3">
          {queue.map(item => (
            <div key={item.id} className="p-4 bg-gray-900 rounded-lg border border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-200">
                  {projects.find(p => p.id === item.project_id)?.original_filename || item.project_id}
                </span>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium ${statusColor(item.status)}`}>
                    {item.status}
                  </span>
                  {item.status === 'queued' || item.status === 'processing' ? (
                    <button
                      onClick={() => handleCancel(item.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>

              {item.status === 'processing' && (
                <div className="mb-2">
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${item.progress * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 mt-1 block">
                    {item.current_step} — {item.progress > 0 ? `${Math.round(item.progress * 100)}%` : '…'}
                  </span>
                </div>
              )}

              {item.error_message && (
                <p className="text-xs text-red-400 mb-2">{item.error_message}</p>
              )}

              {item.exports.length > 0 && (
                <div className="mt-3 space-y-1">
                  <span className="text-xs text-gray-500">
                    {item.exports.length} exported clip{item.exports.length !== 1 ? 's' : ''}
                  </span>
                  {item.exports.map(exp => (
                    <div key={exp.id} className="flex items-center gap-3 p-2 bg-gray-950 rounded text-xs">
                      <span className="text-gray-300 truncate flex-1">{exp.title}</span>
                      <span className="text-gray-500">
                        {exp.start_time.toFixed(1)}s → {exp.end_time.toFixed(1)}s
                      </span>
                      <span className="text-gray-500">{exp.width}×{exp.height}</span>
                      <span className="text-gray-500">{formatBytes(exp.file_size)}</span>
                      {exp.virality_score != null && (
                        <span className="text-yellow-400">★ {exp.virality_score}</span>
                      )}
                      <a
                        href={`/workspace/${exp.export_path.replace(/^.*\/workspace\//, '')}`}
                        download
                        className="text-blue-400 hover:text-blue-300"
                      >
                        Download
                      </a>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-4 text-xs text-gray-500 mt-1">
                <span>Queued: {formatTime(item.queued_at)}</span>
                {item.started_at && <span>Started: {formatTime(item.started_at)}</span>}
                {item.completed_at && <span>Done: {formatTime(item.completed_at)}</span>}
              </div>
            </div>
          ))}
          {queue.length === 0 && (
            <p className="text-gray-500 text-sm p-4 text-center">No items in queue</p>
          )}
        </div>
      </div>
    </div>
  )
}