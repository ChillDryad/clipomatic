import React, { useState, useEffect } from 'react'
import { detectHighlights, getCachedClips } from '../api'
import { ProgressBar } from './ProgressBar'
import type { Clip, Config, Source, Transcript } from '../types'

interface Props {
  transcript: Transcript
  config: Config
  source: Source
  clips: Clip[] | null
  onClips: (clips: Clip[]) => void
}

export function StepHighlights({ transcript, config, source, clips, onClips }: Props) {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cachedCount, setCachedCount] = useState<number | null>(null)

  const sourcePath = source.audioPath ?? source.videoPath ?? null

  const durationHours = transcript.duration / 3600
  const targetCount = Math.max(4, Math.round(durationHours * 3))

  // Check for cached clips on mount / when source changes
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
      if (cached) { onClips(cached); setCachedCount(null) }
    } catch (err) {
      setError(String(err))
    }
  }

  const handleDetect = async () => {
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
      onClips(result)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  return (
    <section className="space-y-6">
      <h2 className="section-title">Step 3 — Find Viral Clips</h2>

      {clips && (
        <p className="mb-3 text-sm text-[var(--ctp-green)]">
          Found <strong className="glowing-number" style={{'--glow-color':'var(--ctp-green)'} as React.CSSProperties}>{clips.length}</strong> clip candidates.
        </p>
      )}

      {cachedCount !== null && !clips && (
        <div className="liquid-card p-3 flex items-center justify-between gap-3">
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
          disabled={loading || !config.llmModel}
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
          Select an LLM model in the sidebar to enable clip detection.
        </p>
      )}

      {progress && (
        <div className="mt-4">
          <ProgressBar progress={progress.value} label={progress.label} />
        </div>
      )}

      {error && (
        <div className="mt-3 liquid-card p-3">
          <p className="text-sm text-[var(--ctp-red)] font-mono whitespace-pre-wrap">{error}</p>
        </div>
      )}
    </section>
  )
}
