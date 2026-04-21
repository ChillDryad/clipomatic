import { useEffect, useState } from 'react'
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom'
import { getAllClips, frameUrl } from '../api'
import type { Clip } from '../types'
import { formatTime } from '../utils/format'

export function VideoDetailPage() {
  const { sourcePath } = useParams<{ sourcePath: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [clips, setClips] = useState<Clip[]>([])
  const [loading, setLoading] = useState(true)
  const [videoTitle, setVideoTitle] = useState<string>('Video')
  const [selectedClips, setSelectedClips] = useState<Set<number>>(new Set())

  // Check for modified data from timeline editor
  const modifiedClip = (location.state as { modifiedClip?: Clip })?.modifiedClip
  const modifiedTranscript = (location.state as { modifiedTranscript?: unknown })?.modifiedTranscript

  useEffect(() => {
    if (!sourcePath) return
    const decoded = decodeURIComponent(sourcePath)
    Promise.all([
      getAllClips(decoded),
      // Fetch project info to get the original filename/title
      fetch(`/api/projects?source_path=${encodeURIComponent(decoded)}`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : null)
        .catch(() => null),
    ])
      .then(([clipsData, projectData]) => {
        setClips([...clipsData].sort((a, b) => b.virality_score - a.virality_score))
        // Use project's original_filename as title, fallback to filename from path
        if (projectData?.projects?.[0]?.original_filename) {
          setVideoTitle(projectData.projects[0].original_filename)
        } else {
          const filename = decoded.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Video'
          setVideoTitle(filename)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sourcePath])

  // If a clip was modified in timeline editor, update local state by matching start/end
  useEffect(() => {
    if (!modifiedClip || clips.length === 0) return
    setClips(prev => {
      const idx = prev.findIndex(
        c => Math.abs(c.start - modifiedClip.start) < 0.1 && Math.abs(c.end - modifiedClip.end) < 0.1
      )
      if (idx === -1) return prev
      return prev.map((c, i) => i === idx ? modifiedClip : c)
    })
    // Also clear the navigation state so re-mount doesn't re-apply stale state
    navigate('.', { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modifiedClip])

  const toggleClip = (index: number) => {
    setSelectedClips(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }


  if (loading) return (
    <div className="text-[var(--ctp-subtext)] p-8" role="status" aria-live="polite">Loading...</div>
  )
  if (!sourcePath) return (
    <div className="text-[var(--ctp-red)] p-8" role="alert">Missing video path</div>
  )

  const decodedPath = decodeURIComponent(sourcePath)

  return (
    <div className="space-y-5">
      {/* Video Info Header */}
      <div className="glass-card p-4 flex gap-4">
        <div className="w-40 h-24 rounded-lg bg-[var(--ctp-surface-1)] overflow-hidden flex-shrink-0">
          <img
            src={frameUrl(decodedPath, 2)}
            alt="Video thumbnail"
            className="w-full h-full object-cover"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[var(--ctp-text)]">{videoTitle}</h1>
          <p className="text-sm text-[var(--ctp-subtext)]">{clips.length} clips detected</p>
          <Link
            to={`/pipeline?restore=${sourcePath}`}
            className="btn-secondary text-sm mt-2 inline-block"
          >
            Re-run Pipeline
          </Link>
        </div>
      </div>

      {/* Clips List */}
      <section aria-labelledby="clips-heading">
        <h2 id="clips-heading" className="text-base font-semibold text-[var(--ctp-text)] mb-3">
          Detected Clips
        </h2>

        {clips.length === 0 ? (
          <div className="glass-card p-5 text-center">
            <p className="text-[var(--ctp-subtext)]">No clips detected yet.</p>
          </div>
        ) : (
          <div className="space-y-2" role="list" aria-label="Detected clips">
            {clips.map((clip, index) => (
              <div key={index} className="glass-card p-3" role="listitem">
                <div className="flex items-start gap-3">
                  <label htmlFor={`clip-checkbox-${index}`} className="sr-only">
                    Select {clip.title}
                  </label>
                  <input
                    id={`clip-checkbox-${index}`}
                    type="checkbox"
                    checked={selectedClips.has(index)}
                    onChange={() => toggleClip(index)}
                    className="mt-0.5 accent-[var(--ctp-mauve)] w-4 h-4 cursor-pointer"
                  />

                  <div className="flex-1">
                    <h3 className="font-semibold text-[var(--ctp-text)]">{clip.title}</h3>
                    <p className="text-xs text-[var(--ctp-subtext)]">
                      {formatTime(clip.start)} - {formatTime(clip.end)}
                    </p>
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {clip.hashtags.map(tag => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]">
                          {tag}
                        </span>
                      ))}
                    </div>
                    {clip.brand_alignment.length > 0 && (
                      <p className="text-[10px] text-[var(--ctp-subtext)] mt-1">
                        {clip.brand_alignment.join(', ')}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0">
                    <span className={`text-xs px-2 py-1 rounded font-medium ${
                      clip.virality_score >= 80 ? 'bg-[var(--ctp-peach)]/20 text-[var(--ctp-peach)]' :
                      clip.virality_score >= 60 ? 'bg-[var(--ctp-yellow)]/20 text-[var(--ctp-yellow)]' :
                      'bg-[var(--ctp-overlay)]/20 text-[var(--ctp-subtext)]'
                    }`}>
                      {clip.virality_score}
                    </span>

                    <button
                      onClick={() => {
                        const decoded = decodeURIComponent(sourcePath ?? '')
                        const twitchQ = decoded.match(/\.m4a$/) ? `?twitchUrl=${encodeURIComponent(decoded)}` : ''
                        navigate(`/video/${sourcePath}/timeline/${clip.id}${twitchQ}`)
                      }}
                      className="btn-secondary text-xs py-1"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Batch Actions */}
      {selectedClips.size > 0 && (
        <div className="glass-card p-4 flex gap-3 items-center">
          <span className="text-[var(--ctp-subtext)]">{selectedClips.size} selected</span>
          <button className="btn-primary">Render Selected</button>
          <button className="btn-secondary">Schedule Posts</button>
        </div>
      )}
    </div>
  )
}

