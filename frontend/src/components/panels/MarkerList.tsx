import { useMemo, useState } from 'react'

export interface Marker {
  id: string
  time: number
  duration?: number
  label: string
  color: string
  created_at?: number
  updated_at?: number
}

interface Props {
  markers: Marker[]
  currentTime: number
  duration: number
  onSeek: (time: number) => void
  onAddMarker: () => void
  onDeleteMarker: (id: string) => void
  onUpdateMarker: (id: string, patch: Partial<Marker>) => void
}

const PRESET_COLORS = [
  '#89b4fa', // blue
  '#cba6f7', // mauve
  '#a6e3a1', // green
  '#fab387', // peach
  '#f38ba8', // red
  '#f9e2af', // yellow
  '#94e2d5', // teal
]

export function MarkerList({
  markers,
  currentTime,
  duration,
  onSeek,
  onAddMarker,
  onDeleteMarker,
  onUpdateMarker,
}: Props) {
  const sortedMarkers = useMemo(() => {
    return [...markers].sort((a, b) => a.time - b.time)
  }, [markers])

  const getNextMarker = useMemo(() => {
    return sortedMarkers.find(m => m.time > currentTime)
  }, [sortedMarkers, currentTime])

  const getPreviousMarker = useMemo(() => {
    return [...sortedMarkers].reverse().find(m => m.time < currentTime)
  }, [sortedMarkers, currentTime])

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 10)
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`
  }

  const handleAddMarker = () => {
    onAddMarker()
  }

  const handleJumpToNext = () => {
    if (getNextMarker) {
      onSeek(getNextMarker.time)
    }
  }

  const handleJumpToPrevious = () => {
    if (getPreviousMarker) {
      onSeek(getPreviousMarker.time)
    }
  }

  return (
    <div className="glass-card p-4 flex flex-col gap-3 min-w-[280px] max-w-md">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--ctp-text)]">Markers</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={handleJumpToPrevious}
            disabled={!getPreviousMarker}
            aria-label="Previous marker"
            className="btn-ghost p-1.5 rounded disabled:opacity-40"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={handleJumpToNext}
            disabled={!getNextMarker}
            aria-label="Next marker"
            className="btn-ghost p-1.5 rounded disabled:opacity-40"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            onClick={handleAddMarker}
            aria-label="Add marker at current time"
            className="btn-primary text-xs px-2 py-1"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Marker count */}
      <div className="text-xs text-[var(--ctp-subtext)]">
        {markers.length} marker{markers.length !== 1 ? 's' : ''} in timeline
      </div>

      {/* Markers list */}
      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
        {sortedMarkers.length === 0 ? (
          <div className="text-xs text-[var(--ctp-subtext)] text-center py-4">
            No markers yet. Press <kbd className="px-1.5 py-0.5 rounded bg-[var(--ctp-surface-1)] text-[var(--ctp-text)] font-mono">M</kbd> to add one at the current time.
          </div>
        ) : (
          sortedMarkers.map((marker) => (
            <MarkerItem
              key={marker.id}
              marker={marker}
              isCurrent={Math.abs(marker.time - currentTime) < 0.1}
              onClick={() => onSeek(marker.time)}
              onDelete={() => onDeleteMarker(marker.id)}
              onUpdate={(patch) => onUpdateMarker(marker.id, patch)}
              formatTime={formatTime}
            />
          ))
        )}
      </div>
    </div>
  )
}

interface MarkerItemProps {
  marker: Marker
  isCurrent: boolean
  onClick: () => void
  onDelete: () => void
  onUpdate: (patch: Partial<Marker>) => void
  formatTime: (seconds: number) => string
}

function MarkerItem({ marker, isCurrent, onClick, onDelete, onUpdate, formatTime }: MarkerItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(marker.label)

  const handleSubmit = () => {
    if (editLabel.trim()) {
      onUpdate({ label: editLabel.trim() })
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      setEditLabel(marker.label)
      setIsEditing(false)
    }
  }

  return (
    <div
      className={`flex items-center gap-2 p-2 rounded-lg transition-colors group ${
        isCurrent
          ? 'bg-[var(--ctp-mauve-20)] border border-[var(--ctp-mauve-30)]'
          : 'hover:bg-[var(--ctp-surface-1)]'
      }`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Color indicator */}
      <div
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: marker.color }}
        aria-hidden="true"
      />

      {/* Time */}
      <span className="text-xs font-mono text-[var(--ctp-subtext)] w-16 flex-shrink-0">
        {formatTime(marker.time)}
      </span>

      {/* Label */}
      {isEditing ? (
        <input
          type="text"
          value={editLabel}
          onChange={(e) => setEditLabel(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={handleKeyDown}
          className="flex-1 text-xs bg-[var(--ctp-surface-1)] border border-[var(--ctp-overlay)] rounded px-2 py-1 text-[var(--ctp-text)] focus:outline-none focus:border-[var(--ctp-mauve)]"
          autoFocus
        />
      ) : (
        <span
          className="flex-1 text-xs text-[var(--ctp-text)] truncate cursor-pointer"
          onDoubleClick={() => setIsEditing(true)}
        >
          {marker.label || 'Unnamed marker'}
        </span>
      )}

      {/* Color picker (compact) */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {PRESET_COLORS.slice(0, 4).map((color) => (
          <button
            key={color}
            onClick={(e) => {
              e.stopPropagation()
              onUpdate({ color })
            }}
            className="w-2.5 h-2.5 rounded-full border border-[var(--ctp-overlay)] hover:scale-125 transition-transform"
            style={{ backgroundColor: color }}
            aria-label={`Change color to ${color}`}
          />
        ))}
      </div>

      {/* Delete button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        aria-label="Delete marker"
        className="p-1 rounded text-[var(--ctp-subtext)] hover:text-[var(--ctp-red)] opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
