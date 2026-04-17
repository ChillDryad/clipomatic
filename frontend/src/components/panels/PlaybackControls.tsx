import { useEffect, useCallback } from 'react'

interface Props {
  isPlaying: boolean
  currentTime: number
  duration: number
  onPlayPause: () => void
  onStepBack: () => void
  onStepForward: () => void
  onSeek: (time: number) => void
}

export function PlaybackControls({
  isPlaying,
  currentTime,
  duration,
  onPlayPause,
  onStepBack,
  onStepForward,
  onSeek,
}: Props) {
  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.code === 'Space' || e.code === 'KeyK') {
        e.preventDefault()
        onPlayPause()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        onStepBack()
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        onStepForward()
      } else if (e.code === 'KeyJ') {
        e.preventDefault()
        onSeek(Math.max(0, currentTime - 1))
      } else if (e.code === 'KeyL') {
        e.preventDefault()
        onSeek(Math.min(duration, currentTime + 1))
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isPlaying, currentTime, duration, onPlayPause, onStepBack, onStepForward, onSeek])

  const handleFrameStep = useCallback((direction: -1 | 1) => {
    // Assuming 30fps, step by 1/30 second
    const frameTime = 1 / 30
    const newTime = Math.max(0, Math.min(duration, currentTime + (direction * frameTime)))
    onSeek(newTime)
  }, [currentTime, duration, onSeek])

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Playback controls">
      {/* Frame backward */}
      <button
        onClick={() => handleFrameStep(-1)}
        aria-label="Previous frame"
        className="btn-ghost p-2 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center"
        title="Previous frame (,)"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Step back (0.5s) */}
      <button
        onClick={onStepBack}
        aria-label="Step back 0.5 seconds"
        className="btn-ghost p-2 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center"
        title="Step back 0.5s (Left Arrow)"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
        </svg>
      </button>

      {/* Play/Pause */}
      <button
        onClick={onPlayPause}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className="btn-primary p-2.5 rounded-lg min-w-[48px] min-h-[48px] flex items-center justify-center"
        title={isPlaying ? 'Pause (Space/K)' : 'Play (Space/K)'}
      >
        {isPlaying ? (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Step forward (0.5s) */}
      <button
        onClick={onStepForward}
        aria-label="Step forward 0.5 seconds"
        className="btn-ghost p-2 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center"
        title="Step forward 0.5s (Right Arrow)"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
        </svg>
      </button>

      {/* Frame forward */}
      <button
        onClick={() => handleFrameStep(1)}
        aria-label="Next frame"
        className="btn-ghost p-2 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center"
        title="Next frame (.)"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Time display */}
      <div className="ml-2 px-3 py-1.5 rounded-lg bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)]">
        <span className="text-sm font-mono text-[var(--ctp-text)]">
          {formatTime(currentTime)} <span className="text-[var(--ctp-subtext)]">/ {formatTime(duration)}</span>
        </span>
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`
}
