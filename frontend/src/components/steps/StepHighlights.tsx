import React, { useState, useEffect } from 'react'
import { detectHighlights, getCachedClips, addClipsToProject, saveCachedClips, parseApiError, checkIngestState, getPipelineJob, cancelPipelineJob } from '../../api'
import { ProgressBar } from '../ui/ProgressBar'
import { usePipeline } from '../../context/PipelineContext'
import { ApiErrorBanner } from '../ui/ApiErrorBanner'

export function StepHighlights() {
  const { transcript, config, source, clips, setClips, projectId, autoPipelineEnabled, activeJobId, setActiveJobId, setAutoPipelineEnabled } = usePipeline()
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null)
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null)
  const [cachedCount, setCachedCount] = useState<number | null>(null)
  const [savingToProject, setSavingToProject] = useState(false)
  const [clipsSaved, setClipsSaved] = useState(false)
  const [autoProgress, setAutoProgress] = useState<{ value: number; label: string } | null>(null)

  const sourcePath = source?.audioPath ?? source?.videoPath ?? null

  const durationHours = (transcript?.duration ?? 0) / 3600
  const targetCount = Math.max(8, Math.round(durationHours * 9))

  // Check for cached clips on mount
  useEffect(() => {
    if (!sourcePath || clips) return
    checkIngestState(sourcePath)
      .then((state) => {
        if (state.clips_cached) {
          getCachedClips(sourcePath)
            .then((cached) => { if (cached) setCachedCount(cached.length) })
            .catch(() => {})
        }
      })
      .catch(() => {})
  }, [sourcePath, clips])

  // Poll auto-pipeline job progress for highlights step
  useEffect(() => {
    if (!autoPipelineEnabled || !activeJobId || clips) return
    const interval = setInterval(async () => {
      try {
        const job = await getPipelineJob(activeJobId)
        if (job.status === 'running' && job.steps[job.current_step] === 'highlights') {
          setAutoProgress({ value: job.step_progress, label: job.step_label || 'Detecting highlights...' })
        } else if (job.status === 'completed') {
          // Highlights done — load cached clips
          if (sourcePath && !clips) {
            try {
              const cached = await getCachedClips(sourcePath)
              if (cached && projectId) {
                await saveCachedClips(projectId, cached)
              }
              if (cached) setClips(cached)
            } catch { /* ignore */ }
          }
          setAutoProgress(null)
        } else if (job.status === 'failed') {
          setAutoProgress(null)
          setError({ message: job.error_message || 'Auto highlight detection failed' })
        }
      } catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(interval)
  }, [autoPipelineEnabled, activeJobId, sourcePath, clips, projectId, setClips])

  const handleCancelAuto = async () => {
    if (!activeJobId) return
    await cancelPipelineJob(activeJobId)
    setActiveJobId(null)
    setAutoProgress(null)
  }

  const handleTakeManualControl = () => {
    setAutoPipelineEnabled(false)
    if (activeJobId) {
      handleCancelAuto()
    }
  }

  const handleLoadCached = async () => {
    if (!sourcePath || !projectId) return
    try {
      const cached = await getCachedClips(sourcePath)
      if (cached) {
        // Save to database
        await saveCachedClips(projectId, cached)
        setClips(cached)
        setCachedCount(null)
      }
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
        projectId,
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
        {autoPipelineEnabled && activeJobId && !clips ? (
          <>
            <div className="flex items-center gap-2 text-sm text-[var(--ctp-blue)]">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Auto-processing...
            </div>
            <button onClick={handleTakeManualControl} className="btn-ghost text-xs px-3 py-1">
              Take Manual Control
            </button>
          </>
        ) : (
          <>
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
          </>
        )}
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

      {autoProgress && (
        <div className="mt-4 space-y-2">
          <ProgressBar progress={autoProgress.value} label={autoProgress.label} />
          <div className="flex justify-end">
            <button onClick={handleCancelAuto} className="text-xs text-[var(--ctp-red)] hover:text-[var(--ctp-red)]/80 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Cancel auto-processing
            </button>
          </div>
        </div>
      )}

      {error && <ApiErrorBanner error={error} onRetry={handleDetect} retryLabel={loading ? 'Retrying...' : 'Retry'} disabled={loading} />}
    </div>
  )
}
