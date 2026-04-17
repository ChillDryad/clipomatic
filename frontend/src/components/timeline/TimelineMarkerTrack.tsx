import { useMemo, useState } from 'react'
import type { Marker } from '../panels/MarkerList'

interface Props {
  markers: Marker[]
  pxPerSecond: number
  duration: number
  currentTime: number
  onSeek: (time: number) => void
  onAddMarker: (time: number) => void
  onDeleteMarker: (id: string) => void
  onUpdateMarker: (id: string, patch: Partial<Marker>) => void
}

export function TimelineMarkerTrack({
  markers,
  pxPerSecond,
  duration,
  currentTime,
  onSeek,
  onAddMarker,
  onDeleteMarker,
  onUpdateMarker,
}: Props) {
  const sortedMarkers = useMemo(() => {
    return [...markers].sort((a, b) => a.time - b.time)
  }, [markers])

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const time = Math.max(0, Math.min(duration, x / pxPerSecond))

    // Check if clicking near an existing marker
    const clickedMarker = sortedMarkers.find(
      m => Math.abs((m.time * pxPerSecond) - x) < 10
    )

    if (clickedMarker) {
      onSeek(clickedMarker.time)
    } else {
      onSeek(time)
    }
  }

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const time = Math.max(0, Math.min(duration, x / pxPerSecond))
    onAddMarker(time)
  }

  return (
    <div className="flex">
      {/* Track label */}
      <div className="w-48 flex-shrink-0 flex items-center gap-2 px-2 py-2 bg-[var(--ctp-surface)] border-r border-b border-[var(--ctp-overlay)]">
        <div className="w-6 h-6 rounded flex items-center justify-center bg-[rgba(137,180,250,0.2)] border border-[#89b4fa]">
          <svg className="w-3.5 h-3.5 text-[#89b4fa]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        </div>
        <span className="text-xs font-medium text-[var(--ctp-text)]">Markers</span>
      </div>

      {/* Marker track area */}
      <div
        className="flex-1 h-10 bg-[var(--ctp-surface-1)] border-b border-[var(--ctp-overlay)] relative cursor-pointer"
        onClick={handleTrackClick}
        onDoubleClick={handleDoubleClick}
        role="application"
        aria-label="Marker track. Click to seek, double-click to add marker."
      >
        {/* Grid lines */}
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => (
            <div
              key={i}
              className={`absolute top-0 bottom-0 w-px ${
                i % 5 === 0 ? 'bg-[var(--ctp-overlay)]' : 'bg-[var(--ctp-overlay)] opacity-30'
              }`}
              style={{ left: i * pxPerSecond }}
              aria-hidden="true"
            />
          ))}
        </div>

        {/* Markers */}
        {sortedMarkers.map((marker) => (
          <MarkerIndicator
            key={marker.id}
            marker={marker}
            pxPerSecond={pxPerSecond}
            currentTime={currentTime}
            onClick={() => onSeek(marker.time)}
            onDelete={() => onDeleteMarker(marker.id)}
            onUpdate={(patch) => onUpdateMarker(marker.id, patch)}
          />
        ))}
      </div>
    </div>
  )
}

interface MarkerIndicatorProps {
  marker: Marker
  pxPerSecond: number
  currentTime: number
  onClick: () => void
  onDelete: () => void
  onUpdate: (patch: Partial<Marker>) => void
}

function MarkerIndicator({ marker, pxPerSecond, currentTime, onClick, onDelete, onUpdate }: MarkerIndicatorProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(marker.label)
  const [isDragging, setIsDragging] = useState(false)

  const isCurrent = Math.abs(marker.time - currentTime) < 0.1
  const left = marker.time * pxPerSecond

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDragging(true)

    const startX = e.clientX
    const startTime = marker.time

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX
      const dt = dx / pxPerSecond
      const newTime = Math.max(0, Math.min(startTime + dt, 3600)) // Max 1 hour
      onUpdate({ time: newTime })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const handleSubmit = () => {
    if (editLabel.trim()) {
      onUpdate({ label: editLabel.trim() })
    }
    setIsEditing(false)
  }

  return (
    <div
      className="absolute top-0 bottom-0 group"
      style={{ left: left - 6 }}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      role="button"
      tabIndex={0}
      aria-label={`Marker: ${marker.label || 'Unnamed'} at ${marker.time.toFixed(1)}s`}
    >
      {/* Marker flag */}
      <div
        className={`absolute top-1 w-3 h-3 rotate-45 transform transition-all cursor-ew-resize ${
          isCurrent
            ? 'ring-2 ring-[var(--ctp-mauve)] ring-offset-1 ring-offset-[var(--ctp-base)]'
            : 'hover:scale-110'
        } ${isDragging ? 'opacity-80' : ''}`}
        style={{
          backgroundColor: marker.color,
          left: 6,
        }}
        onMouseDown={handleMouseDown}
      />

      {/* Marker label (shown on hover or when current) */}
      {(isCurrent || isDragging) && (
        <div
          className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-[var(--ctp-base)] border border-[var(--ctp-overlay)] shadow-lg whitespace-nowrap z-10"
          style={{ left: 6 }}
        >
          {isEditing ? (
            <input
              type="text"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              onBlur={handleSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit()
                if (e.key === 'Escape') {
                  setEditLabel(marker.label)
                  setIsEditing(false)
                }
              }}
              className="text-xs bg-transparent border-none outline-none text-[var(--ctp-text)] w-24"
              autoFocus
            />
          ) : (
            <span
              className="text-xs text-[var(--ctp-text)] cursor-pointer"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setIsEditing(true)
              }}
            >
              {marker.label || formatTime(marker.time)}
            </span>
          )}
        </div>
      )}

      {/* Delete button (shown on hover) */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="absolute -top-6 left-1/2 -translate-x-1/2 p-1 rounded bg-[var(--ctp-red)] text-[var(--ctp-base)] opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Delete marker"
        style={{ left: 6 }}
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Vertical line */}
      <div
        className="absolute top-3 bottom-0 w-px pointer-events-none"
        style={{
          backgroundColor: marker.color,
          opacity: isCurrent ? 0.6 : 0.3,
          left: 7.5,
        }}
        aria-hidden="true"
      />
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
