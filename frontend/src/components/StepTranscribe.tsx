import React, { useState } from 'react'
import { transcribe, getCachedTranscript } from '../api'
import { ProgressBar } from './ProgressBar'
import type { Config, Source, Transcript } from '../types'

interface Props {
  source: Source
  transcript: Transcript | null
  config: Config
  onTranscript: (t: Transcript) => void
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`
}

export function StepTranscribe({ source, transcript, config, onTranscript }: Props) {
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  const sourcePath = source.audioPath ?? source.videoPath ?? ''

  const handleTranscribe = async () => {
    setError(null)
    setProgress({ value: 0, label: 'Starting…' })
    try {
      const result = await transcribe(
        {
          video_path: source.videoPath ?? undefined,
          audio_path: source.audioPath ?? undefined,
          model_size: config.whisperModel,
          device: config.whisperDevice,
          language: undefined,
        },
        (value, label) => setProgress({ value, label }),
      )
      setProgress(null)
      onTranscript(result)
    } catch (err) {
      setProgress(null)
      setError(String(err))
    }
  }

  const handleLoadCached = async () => {
    try {
      const cached = await getCachedTranscript(sourcePath)
      if (cached) onTranscript(cached)
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
    <section className="space-y-6">
      <h2 className="section-title">Step 2 — Transcribe</h2>

      {transcript && (
        <div className="liquid-card p-4 space-y-3">
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
              className="w-full bg-[var(--ctp-surface)] border liquid-input rounded p-2 text-xs text-[var(--ctp-subtext)] font-mono resize-y"
            />
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={handleTranscribe}
          disabled={!!progress}
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
