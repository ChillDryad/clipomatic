import React, { useState, useEffect } from 'react'
import { transcribe, getCachedTranscript, saveCachedTranscript, parseApiError, getAbortController, cancelOperation, checkIngestState } from '../../api'
import { ProgressBar } from '../ui/ProgressBar'
import { usePipeline } from '../../context/PipelineContext'
import { formatDuration } from '../../utils/format'
import { ApiErrorBanner } from '../ui/ApiErrorBanner'

export function StepTranscribe() {
  const { source, transcript, config, setTranscript, projectId } = usePipeline()
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null)
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [hasCachedTranscript, setHasCachedTranscript] = useState(false)

  const handleCancel = () => {
    setIsCancelling(true)
    cancelOperation('transcribe')
  }

  const sourcePath = source?.audioPath ?? source?.videoPath ?? ''

  // Check for cached transcript on mount
  useEffect(() => {
    if (!sourcePath || transcript) return
    checkIngestState(sourcePath)
      .then((state) => {
        if (state.transcript_cached) setHasCachedTranscript(true)
      })
      .catch(() => {})
  }, [sourcePath, transcript])

  const handleTranscribe = async () => {
    if (!source) return
    setError(null)
    setProgress({ value: 0, label: 'Starting…' })
    setIsCancelling(false)
    try {
      const controller = getAbortController('transcribe')
      const result = await transcribe(
        {
          video_path: source.videoPath ?? undefined,
          audio_path: source.audioPath ?? undefined,
          model_size: config.whisperModel,
          device: config.whisperDevice,
          language: 'en',
          project_id: projectId ?? undefined,
        },
        (value, label) => setProgress({ value, label }),
        controller.signal,
      )
      setProgress(null)
      setTranscript(result)
      setHasCachedTranscript(false)
    } catch (err) {
      setProgress(null)
      if (String(err).includes('cancelled')) {
        setError({ message: 'Transcription cancelled' })
      } else {
        setError(parseApiError(err))
      }
    } finally {
      setIsCancelling(false)
    }
  }

  const handleLoadCached = async () => {
    try {
      const cached = await getCachedTranscript(sourcePath)
      if (cached && projectId) {
        // Save to database
        await saveCachedTranscript(projectId, cached)
        setTranscript(cached)
        setHasCachedTranscript(false)
      } else if (cached) {
        setTranscript(cached)
        setHasCachedTranscript(false)
      }
    } catch {
      // ignore
    }
  }

  const rawText = transcript?.segments.map((s) => {
    const m = Math.floor(s.start / 60)
    const sec = (s.start % 60).toFixed(2).padStart(5, '0')
    return `[${String(m).padStart(2, '0')}:${sec}] ${s.text}`
  }).join('\n') ?? ''

  return (
    <div className="space-y-6">
      {hasCachedTranscript && !transcript && (
        <div className="glass-card p-3 flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--ctp-blue)]">
            Cached transcript found from a previous run.
          </p>
          <button onClick={handleLoadCached} className="btn-primary text-sm py-1 shrink-0">
            Load cached transcript
          </button>
        </div>
      )}

      {transcript && (
        <div className="glass-card p-4 space-y-3">
          <p className="text-sm text-[var(--ctp-green)]">
            Transcript ready —{' '}
            <span className="glowing-number font-bold" style={{'--glow-color':'var(--ctp-green)'} as React.CSSProperties}>
              {transcript.segments.length}
            </span>{' '}
            segments,{' '}
            <span className="glowing-number font-bold" style={{'--glow-color':'var(--ctp-green)'} as React.CSSProperties}>
              {formatDuration(transcript.duration)}
            </span>
            , language:{' '}
            <strong>{transcript.language}</strong>{' '}
            ({(transcript.language_probability * 100).toFixed(0)}% confidence)
          </p>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)] transition-colors"
          >
            {showRaw ? 'Hide' : 'Show'} raw transcript
          </button>
          {showRaw && (
            <textarea
              readOnly
              value={rawText}
              rows={10}
              className="w-full bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded-lg p-2 text-xs text-[var(--ctp-subtext)] font-mono resize-y"
            />
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={handleTranscribe}
          disabled={!!progress || !source}
          className="btn-primary"
        >
          {transcript ? 'Re-transcribe' : 'Transcribe'} with Whisper
        </button>
      </div>

      <p className="mt-2 text-xs text-[var(--ctp-subtext)]">
        Model: <code className="text-[var(--ctp-text)]">{config.whisperModel}</code> · Device:{' '}
        <code className="text-[var(--ctp-text)]">{config.whisperDevice}</code>
      </p>

      {progress && (
        <div className="mt-4 space-y-2">
          <ProgressBar progress={progress.value} label={progress.label} />
          <div className="flex justify-end">
            <button
              onClick={handleCancel}
              disabled={isCancelling}
              className="text-xs text-[var(--ctp-red)] hover:text-[var(--ctp-red)]/80 disabled:opacity-50 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              {isCancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {error && <ApiErrorBanner error={error} onRetry={handleTranscribe} />}
    </div>
  )
}

