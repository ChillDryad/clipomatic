import React, { useState, useEffect } from 'react'
import { detectHighlights, getCachedClips, addClipsToProject, parseApiError } from '../../api'
import { ProgressBar } from '../ui/ProgressBar'
import { usePipeline } from '../../context/PipelineContext'

export function StepHighlights() {
  const { transcript, config, source, clips, setClips, projectId } = usePipeline()
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null)
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null)
  const [cachedCount, setCachedCount] = useState<number | null>(null)
  const [savingToProject, setSavingToProject] = useState(false)
  const [clipsSaved, setClipsSaved] = useState(false)

  const sourcePath = source?.audioPath ?? source?.videoPath ?? null

  const durationHours = (transcript?.duration ?? 0) / 3600
  const targetCount = Math.max(4, Math.round(durationHours * 3))

  useEffect(() => {
    if (!sourcePath || clips) return
    getCachedClips(sourcePath)
      .then((cached) => { if (cached) setCachedCount(cached.length) })
      .catch(() => {})
  }, [sourcePath, clips])

  const handleLoadCached = async () => {
    if (!sourcePath) return
    try {
      const cached = await getCachedClips(sourcePath)
      if (cached) { setClips(cached); setCachedCount(null) }
    } catch (err) {
      setError(parseApiError(err))
    }
  }

  // Save clips to project when detected, then redirect to project page
  useEffect(() => {
    if (!clips || !projectId || clips.length === 0 || savingToProject || clipsSaved) return

    const saveClips = async () => {
      setSavingToProject(true)
      try {
        await addClipsToProject(projectId, clips.map(clip => ({
          title: clip.title,
          start: clip.start,
          end: clip.end,
          reason: clip.reason,
          virality_score: clip.virality_score,
          brand_alignment: clip.brand_alignment,
          hashtags: clip.hashtags,
        })))
        setClipsSaved(true)
        // Redirect to project page after clips are saved
        window.location.href = `/video/${projectId}`
      } catch (err) {
        console.error('Failed to save clips to project:', err)
        setSavingToProject(false)
      }
    }

    saveClips()
  }, [clips, projectId, clipsSaved])

  const handleDetect = async () => {
    if (!transcript || !config.llmModel) return
    setError(null)
    setLoading(true)
    setProgress({ value: 0, label: 'Starting…' })
    try {
      const result = await detectHighlights(
        transcript,
        config.llmModel,
        sourcePath,
        (p, label) => setProgress({ value: p, label }),
      )
      setCachedCount(null)
      setClips(result)
    } catch (err) {
      setError(parseApiError(err))
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  return (
    <div className="space-y-6">
      {clips && (
        <p className="mb-3 text-sm text-[var(--ctp-green)]">
          Found <strong className="glowing-number" style={{'--glow-color':'var(--ctp-green)'} as React.CSSProperties}>{clips.length}</strong> clip candidates.
        </p>
      )}

      {cachedCount !== null && !clips && (
        <div className="glass-card p-3 flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--ctp-blue)]">
            {cachedCount} clips cached from a previous run.
          </p>
          <button onClick={handleLoadCached} className="btn-primary text-sm py-1 shrink-0">
            Load cached clips
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleDetect}
          disabled={loading || !config.llmModel || !transcript}
          className="btn-primary"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Analysing transcript…
            </span>
          ) : clips ? 'Re-detect clips' : 'Find Viral Clips'}
        </button>
        <span className="text-xs text-[var(--ctp-subtext)]">
          Model: <code className="text-[var(--ctp-text)]">{config.llmModel || '(none)'}</code> · Targeting ~{targetCount} clips
        </span>
      </div>

      {!config.llmModel && (
        <p className="mt-2 text-xs text-[var(--ctp-yellow)]">
          Select an LLM model in Settings to enable clip detection.
        </p>
      )}

      {progress && (
        <div className="mt-4">
          <ProgressBar progress={progress.value} label={progress.label} />
        </div>
      )}

      {error && (
        <div className="mt-3 glass-card p-3 border-l-4 border-[var(--ctp-red)]">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-[var(--ctp-red)] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--ctp-red)] mb-1">{error.message}</p>
              {error.suggestion && (
                <p className="text-xs text-[var(--ctp-subtext)] mb-2">{error.suggestion}</p>
              )}
              <button
                onClick={handleDetect}
                disabled={loading}
                className="text-xs text-[var(--ctp-blue)] hover:text-[var(--ctp-text)] flex items-center gap-1 disabled:opacity-50"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {loading ? 'Retrying...' : 'Retry'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
