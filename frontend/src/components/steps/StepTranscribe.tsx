import React, { useState } from 'react'
import { transcribe, getCachedTranscript, parseApiError, getAbortController, cancelOperation } from '../../api'
import { ProgressBar } from '../ui/ProgressBar'
import { usePipeline } from '../../context/PipelineContext'

export function StepTranscribe() {
  const { source, transcript, config, setTranscript } = usePipeline()
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null)
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  const handleCancel = () => {
    setIsCancelling(true)
    cancelOperation('transcribe')
  }

  const sourcePath = source?.audioPath ?? source?.videoPath ?? ''

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
          language: undefined,
        },
        (value, label) => setProgress({ value, label }),
        controller.signal,
      )
      setProgress(null)
      setTranscript(result)
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
      if (cached) setTranscript(cached)
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
        {!transcript && (
          <button
            onClick={handleLoadCached}
            disabled={!!progress}
            className="btn-secondary"
          >
            Load cached transcript
          </button>
        )}
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
                onClick={handleTranscribe}
                className="text-xs text-[var(--ctp-blue)] hover:text-[var(--ctp-text)] flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Retry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`
}
