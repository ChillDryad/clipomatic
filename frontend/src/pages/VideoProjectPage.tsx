import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { frameUrl } from '../api'
import type { Clip } from '../types'

interface VideoProject {
  id: string
  owner_id: string
  team_id: string | null
  source_path: string
  original_filename: string
  duration: number | null
  status: 'pending' | 'processing' | 'complete' | 'failed'
  created_at: number
  updated_at: number
  owner: { id: string; display_name: string | null; email: string }
  team?: { id: string; name: string } | null
  clips?: Clip[]
}

interface TeamMember {
  id: string
  user_id: string
  user: { id: string; display_name: string | null; email: string }
  role: 'owner' | 'admin' | 'editor' | 'viewer'
}

export function VideoProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const [project, setProject] = useState<VideoProject | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // FIX: Use clip IDs instead of indices to avoid mismatch when sorted
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true })
      return
    }
    if (!projectId) return
    loadProject(projectId)
  }, [projectId, isAuthenticated])

  const loadProject = async (id: string) => {
    setLoading(true)
    setError(null)

    try {
      const [projectRes, clipsRes] = await Promise.all([
        fetch(`/api/projects/${id}`, { credentials: 'include' }),
        fetch(`/api/projects/${id}/clips`, { credentials: 'include' })
      ])

      if (projectRes.status === 403 || projectRes.status === 404) {
        setError('Project not found or access denied')
        setLoading(false)
        return
      }

      if (!projectRes.ok) throw new Error(await projectRes.text())
      const projectData = await projectRes.json()
      setProject(projectData)

      if (clipsRes.ok) {
        const clipsData = await clipsRes.json()
        setClips(clipsData.clips || clipsData)
      }

      // Load team members if project belongs to a team
      if (projectData.team_id) {
        const membersRes = await fetch(`/api/teams/${projectData.team_id}/members`, { credentials: 'include' })
        if (membersRes.ok) {
          const membersData = await membersRes.json()
          setMembers(membersData.members || [])
        }
      }
    } catch (err) {
      console.error('Failed to load project:', err)
      setError(err instanceof Error ? err.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  // FIX: Toggle by clip ID instead of array index
  const toggleClip = (clipId: string) => {
    setSelectedClipIds(prev => {
      const next = new Set(prev)
      if (next.has(clipId)) next.delete(clipId)
      else next.add(clipId)
      return next
    })
  }

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const formatDuration = (seconds: number | null): string => {
    if (seconds === null) return 'Unknown'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}h ${m}m ${s}s`
    return `${m}m ${s}s`
  }

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const getRoleBadgeColor = (role: string): string => {
    switch (role) {
      case 'owner': return 'bg-[var(--ctp-mauve)]/20 text-[var(--ctp-mauve)] border-[var(--ctp-mauve)]/30'
      case 'admin': return 'bg-[var(--ctp-blue)]/20 text-[var(--ctp-blue)] border-[var(--ctp-blue)]/30'
      case 'editor': return 'bg-[var(--ctp-green)]/20 text-[var(--ctp-green)] border-[var(--ctp-green)]/30'
      case 'viewer': return 'bg-[var(--ctp-overlay)]/20 text-[var(--ctp-subtext)] border-[var(--ctp-overlay)]/30'
      default: return 'bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]'
    }
  }

  const getViralityBadgeColor = (score: number): string => {
    if (score >= 80) return 'bg-[var(--ctp-green)]/20 text-[var(--ctp-green)] border-[var(--ctp-green)]/30'
    if (score >= 60) return 'bg-[var(--ctp-yellow)]/20 text-[var(--ctp-yellow)] border-[var(--ctp-yellow)]/30'
    return 'bg-[var(--ctp-overlay)]/20 text-[var(--ctp-subtext)] border-[var(--ctp-overlay)]/30'
  }

  if (loading) {
    return (
      <div className="text-[var(--ctp-subtext)] p-8 text-center" role="status" aria-live="polite">
        <div className="inline-flex items-center gap-2">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Loading project...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="glass-card p-6 text-center">
        <p className="text-[var(--ctp-red)] mb-4">{error}</p>
        <Button onClick={() => navigate('/dashboard')} variant="primary">Go to Dashboard</Button>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="glass-card p-6 text-center">
        <p className="text-[var(--ctp-subtext)]">Project not found</p>
        <Button onClick={() => navigate('/dashboard')} variant="primary" className="mt-4">Go to Dashboard</Button>
      </div>
    )
  }

  const sortedClips = [...clips].sort((a, b) => b.virality_score - a.virality_score)

  return (
    <div className="space-y-6">
      {/* Project Header */}
      <div className="glass-card p-5">
        <div className="flex gap-4">
          {/* Thumbnail */}
          <div className="w-48 h-28 rounded-lg bg-[var(--ctp-surface-1)] overflow-hidden flex-shrink-0">
            <img
              src={frameUrl(project.source_path, 2)}
              alt="Video thumbnail"
              className="w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>

          {/* Info */}
          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-bold text-[var(--ctp-text)]">{project.original_filename}</h1>
                <p className="text-sm text-[var(--ctp-subtext)] mt-1">
                  Duration: {formatDuration(project.duration)} · {clips.length} clips detected
                </p>
                <p className="text-xs text-[var(--ctp-subtext)] mt-1">
                  Created: {formatDate(project.created_at)}
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded font-medium border ${
                project.status === 'complete' ? 'bg-[var(--ctp-green)]/20 text-[var(--ctp-green)] border-[var(--ctp-green)]/30' :
                project.status === 'processing' ? 'bg-[var(--ctp-blue)]/20 text-[var(--ctp-blue)] border-[var(--ctp-blue)]/30' :
                project.status === 'failed' ? 'bg-[var(--ctp-red)]/20 text-[var(--ctp-red)] border-[var(--ctp-red)]/30' :
                'bg-[var(--ctp-overlay)]/20 text-[var(--ctp-subtext)] border-[var(--ctp-overlay)]/30'
              }`}>
                {project.status}
              </span>
            </div>

            {/* Team badge */}
            {project.team && (
              <div className="mt-2">
                <span className="text-xs px-2 py-1 rounded bg-[var(--ctp-mauve)]/20 text-[var(--ctp-mauve)] border border-[var(--ctp-mauve)]/30">
                  Team: {project.team.name}
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-3">
              <Link
                to={`/pipeline?restore=${encodeURIComponent(project.source_path)}`}
                className="btn-secondary text-sm py-1"
              >
                Re-run Pipeline
              </Link>
              {project.status === 'complete' && (
                <Button variant="primary" size="sm">Export All Clips</Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Clips List */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-base font-semibold text-[var(--ctp-text)]">
            Detected Clips ({clips.length})
          </h2>

          {clips.length === 0 ? (
            <div className="glass-card p-6 text-center">
              <p className="text-[var(--ctp-subtext)] mb-3">No clips detected yet</p>
              <Link to={`/pipeline?restore=${encodeURIComponent(project.source_path)}`} className="btn-primary">
                Run Highlight Detection
              </Link>
            </div>
          ) : (
            <div className="space-y-2" role="list" aria-label="Detected clips">
              {sortedClips.map((clip) => {
                const clipKey = clip.id || `idx-${clip.index}`
                return (
                <div key={clipKey} className="glass-card p-3" role="listitem">
                  <div className="flex items-start gap-3">
                    <label htmlFor={`clip-checkbox-${clipKey}`} className="sr-only">
                      Select {clip.title}
                    </label>
                    <input
                      id={`clip-checkbox-${clipKey}`}
                      type="checkbox"
                      checked={selectedClipIds.has(clipKey)}
                      onChange={() => toggleClip(clipKey)}
                      className="mt-0.5 accent-[var(--ctp-mauve)] w-4 h-4 cursor-pointer"
                    />

                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-[var(--ctp-text)] truncate">{clip.title}</h3>
                      <p className="text-xs text-[var(--ctp-subtext)] mt-0.5">
                        {formatTime(clip.start)} - {formatTime(clip.end)}
                      </p>
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        {clip.hashtags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]">
                            {tag}
                          </span>
                        ))}
                      </div>
                      {clip.brand_alignment.length > 0 && (
                        <p className="text-[10px] text-[var(--ctp-subtext)] mt-1 truncate">
                          {clip.brand_alignment.join(', ')}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5 shrink-0">
                      <span className={`text-xs px-2 py-1 rounded font-medium border ${getViralityBadgeColor(clip.virality_score)}`}>
                        {clip.virality_score}
                      </span>

                      <Link
                        to={`/video/${project.id}/timeline/${clip.id || clip.index}`}
                        className="btn-secondary text-xs py-1"
                      >
                        Edit
                      </Link>
                    </div>
                  </div>
                </div>
              )})}
            </div>
          )}

          {/* Batch Actions */}
          {selectedClipIds.size > 0 && (
            <div className="glass-card p-4 flex gap-3 items-center sticky bottom-4">
              <span className="text-[var(--ctp-subtext)]">{selectedClipIds.size} selected</span>
              <Button variant="primary">Render Selected</Button>
              <Button variant="secondary">Schedule Posts</Button>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Team Members */}
          {members.length > 0 && (
            <div className="glass-card p-4">
              <h3 className="text-sm font-semibold text-[var(--ctp-text)] mb-3">Team Members</h3>
              <div className="space-y-2">
                {members.map(member => (
                  <div key={member.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-[var(--ctp-mauve)]/20 flex items-center justify-center text-xs font-medium text-[var(--ctp-mauve)]">
                        {(member.user.display_name || member.user.email)[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs text-[var(--ctp-text)]">
                          {member.user.display_name || member.user.email}
                        </p>
                        {member.user.email !== member.user.display_name && (
                          <p className="text-[10px] text-[var(--ctp-subtext)]">{member.user.email}</p>
                        )}
                      </div>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${getRoleBadgeColor(member.role)}`}>
                      {member.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Project Info */}
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-[var(--ctp-text)] mb-3">Project Info</h3>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-[var(--ctp-subtext)]">Owner</dt>
                <dd className="text-[var(--ctp-text)]">{project.owner.display_name || project.owner.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ctp-subtext)]">Created</dt>
                <dd className="text-[var(--ctp-text)]">{formatDate(project.created_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ctp-subtext)]">Updated</dt>
                <dd className="text-[var(--ctp-text)]">{formatDate(project.updated_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ctp-subtext)]">Duration</dt>
                <dd className="text-[var(--ctp-text)]">{formatDuration(project.duration)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ctp-subtext)]">Status</dt>
                <dd className="text-[var(--ctp-text)] capitalize">{project.status}</dd>
              </div>
            </dl>
          </div>

          {/* Quick Actions */}
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-[var(--ctp-text)] mb-3">Quick Actions</h3>
            <div className="space-y-2">
              <Link
                to={`/pipeline?restore=${encodeURIComponent(project.source_path)}`}
                className="block btn-secondary text-sm text-center"
              >
                Re-transcribe
              </Link>
              <Button variant="secondary" size="sm" className="w-full">Share Project</Button>
              <Button variant="danger" size="sm" className="w-full">Delete Project</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
