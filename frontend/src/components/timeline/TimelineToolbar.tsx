import { useEffect, useState } from 'react'

export interface RenderSettings {
  fontSize: number
  wordsPerLine: number
  qualityPreset: 'standard' | 'production' | 'nvenc'
  captionStyle: 'karaoke' | 'capcut'
}

interface RenderProgress {
  p: number
  l: string
}

interface Props {
  isPlaying: boolean
  canSplit: boolean
  canDelete: boolean
  canUndo: boolean
  canRedo: boolean
  pxPerSecond: number
  onPlayPause: () => void
  onStepBack: () => void
  onStepForward: () => void
  onSplit: () => void
  onDelete: () => void
  onAddSubtitle: () => void
  onUndo?: () => void
  onRedo?: () => void
  setPxPerSecond?: (n: number) => void
  // Render props
  renderSettings: RenderSettings
  onRenderSettingsChange: (s: RenderSettings) => void
  onRender: (progress: RenderProgress) => void
}

export function TimelineToolbar({
  isPlaying,
  canSplit,
  canDelete,
  canUndo,
  canRedo,
  pxPerSecond,
  onPlayPause,
  onStepBack,
  onStepForward,
  onSplit,
  onDelete,
  onAddSubtitle,
  onUndo,
  onRedo,
  setPxPerSecond,
  renderSettings,
  onRenderSettingsChange,
  onRender,
}: Props) {
  const [showRenderSettings, setShowRenderSettings] = useState(false)
  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.code === 'Space') {
        e.preventDefault()
        onPlayPause()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        onStepBack()
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        onStepForward()
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault()
        if (canDelete) onDelete()
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault()
        if (canUndo) onUndo?.()
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && e.shiftKey) {
        e.preventDefault()
        if (canRedo) onRedo?.()
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isPlaying, canSplit, canDelete, onPlayPause, onStepBack, onStepForward, onSplit, onDelete])

  return (
    <div className="glass-card p-3 flex items-center gap-3 flex-wrap">
      {/* Playback controls */}
      <div className="flex items-center gap-1" role="group" aria-label="Playback controls">
        <button
          onClick={onStepBack}
          aria-label="Step back 0.5 seconds"
          className="btn-ghost p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
          </svg>
        </button>

        <button
          onClick={onPlayPause}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="btn-primary p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          {isPlaying ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <button
          onClick={onStepForward}
          aria-label="Step forward 0.5 seconds"
          className="btn-ghost p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
          </svg>
        </button>
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-[var(--ctp-overlay)]" aria-hidden="true" />

      {/* Editing controls */}
      <button
        onClick={onSplit}
        disabled={!canSplit}
        aria-disabled={!canSplit}
        aria-label="Split segment at playhead"
        className="btn-secondary text-sm disabled:opacity-40 min-h-[44px]"
      >
        Split
      </button>

      <button
        onClick={onDelete}
        disabled={!canDelete}
        aria-disabled={!canDelete}
        aria-label="Delete selected segment"
        className="btn-danger text-sm disabled:opacity-40 min-h-[44px]"
      >
        Delete
      </button>

      <button
        onClick={onAddSubtitle}
        aria-label="Add subtitle at playhead"
        className="btn-secondary text-sm min-h-[44px]"
      >
        + Subtitle
      </button>

      {/* Divider */}
      <div className="w-px h-6 bg-[var(--ctp-overlay)]" aria-hidden="true" />

      {/* Undo/Redo */}
      <button
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo"
        className="btn-ghost text-sm disabled:opacity-40 min-h-[44px]"
      >
        Undo
      </button>

      <button
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="Redo"
        className="btn-ghost text-sm disabled:opacity-40 min-h-[44px]"
      >
        Redo
      </button>

      {/* Divider */}
      <div className="w-px h-6 bg-[var(--ctp-overlay)]" aria-hidden="true" />

      {/* Zoom controls */}
      <button
        onClick={() => setPxPerSecond?.(Math.max(10, pxPerSecond - 10))}
        aria-label="Zoom out"
        className="btn-ghost p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
        </svg>
      </button>

      <button
        onClick={() => setPxPerSecond?.(Math.min(200, pxPerSecond + 10))}
        aria-label="Zoom in"
        className="btn-ghost p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Divider */}
      <div className="w-px h-6 bg-[var(--ctp-overlay)]" aria-hidden="true" />

      {/* Render controls */}
      <button
        onClick={() => {
          setShowRenderSettings(s => !s)
          onRender({ p: 0, l: '' })
        }}
        aria-label="Render clip"
        className="btn-primary text-sm min-h-[44px]"
      >
        Render
      </button>

      {/* Render settings dropdown */}
      {showRenderSettings && (
        <div className="glass-card p-3 flex flex-col gap-3 min-w-[280px]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--ctp-text)]">Render Settings</span>
            <button
              onClick={() => setShowRenderSettings(false)}
              className="btn-ghost text-xs p-1"
            >
              Close
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--ctp-subtext)] min-w-[70px]">Font size</label>
            <input
              type="range"
              min="12"
              max="48"
              value={renderSettings.fontSize}
              onChange={e => onRenderSettingsChange({ ...renderSettings, fontSize: parseInt(e.target.value) })}
              className="flex-1"
            />
            <span className="text-xs text-[var(--ctp-subtext)] w-8">{renderSettings.fontSize}</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--ctp-subtext)] min-w-[70px]">Words/line</label>
            <input
              type="range"
              min="1"
              max="4"
              value={renderSettings.wordsPerLine}
              onChange={e => onRenderSettingsChange({ ...renderSettings, wordsPerLine: parseInt(e.target.value) })}
              className="flex-1"
            />
            <span className="text-xs text-[var(--ctp-subtext)] w-8">{renderSettings.wordsPerLine}</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--ctp-subtext)] min-w-[70px]">Quality</label>
            <div className="flex gap-1">
              {(['standard', 'production', 'nvenc'] as const).map(q => (
                <button
                  key={q}
                  onClick={() => onRenderSettingsChange({ ...renderSettings, qualityPreset: q })}
                  className={`px-2 py-1 rounded text-xs ${renderSettings.qualityPreset === q ? 'bg-[var(--ctp-mauve)] text-[var(--ctp-base)]' : 'bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]'}`}
                >
                  {q === 'nvenc' ? 'GPU (NVENC)' : q}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--ctp-subtext)] min-w-[70px]">Caption</label>
            <div className="flex gap-1">
              {(['karaoke', 'capcut'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => onRenderSettingsChange({ ...renderSettings, captionStyle: s })}
                  className={`px-2 py-1 rounded text-xs ${renderSettings.captionStyle === s ? 'bg-[var(--ctp-mauve)] text-[var(--ctp-base)]' : 'bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}