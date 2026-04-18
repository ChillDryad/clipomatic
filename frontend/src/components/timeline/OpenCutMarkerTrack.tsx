import React, { useMemo, useState, useCallback } from 'react'

export interface Marker {
  id: string
  time: number
  label?: string
  color?: string
}

interface OpenCutMarkerTrackProps {
  markers: Marker[]
  zoom: number
  duration: number
  currentTime: number
  onSeek: (time: number) => void
  onAddMarker: (time: number) => void
  onDeleteMarker: (id: string) => void
  onUpdateMarker: (id: string, patch: Partial<Marker>) => void
}

export function OpenCutMarkerTrack({
  markers,
  zoom,
  duration,
  currentTime,
  onSeek,
  onAddMarker,
  onDeleteMarker,
  onUpdateMarker,
}: OpenCutMarkerTrackProps) {
  const sortedMarkers = useMemo(() => {
    return [...markers].sort((a, b) => a.time - b.time)
  }, [markers])

  const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const time = Math.max(0, Math.min(duration, x / zoom))
    onSeek(time)
  }, [zoom, duration, onSeek])

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const time = Math.max(0, Math.min(duration, x / zoom))
    onAddMarker(time)
  }, [zoom, duration, onAddMarker])

  return (
    <div
      className="flex h-10 border-b border-[var(--ctp-overlay)] bg-[var(--ctp-surface)]/95 backdrop-blur"
      onDoubleClick={handleDoubleClick}
    >
      {/* Track label */}
      <div
        className="w-[60px] flex-shrink-0 flex items-center px-2 border-r border-[var(--ctp-overlay)] bg-[var(--ctp-surface)]"
        onClick={handleTrackClick}
      >
        <div className="w-5 h-5 rounded flex items-center justify-center bg-[rgba(137,180,250,0.2)] border border-[var(--ctp-blue)]">
          <svg className="w-3 h-3 text-[var(--ctp-blue)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        </div>
      </div>

      {/* Marker track area */}
      <div
        className="flex-1 relative cursor-pointer overflow-hidden"
        onClick={handleTrackClick}
        style={{ width: Math.max(duration * zoom, 1000) - 60 }}
      >
        {/* Grid lines */}
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => (
            <div
              key={i}
              className={`absolute top-0 bottom-0 w-px ${
                i % 5 === 0 ? 'bg-[var(--ctp-overlay)]' : 'bg-[var(--ctp-overlay)] opacity-30'
              }`}
              style={{ left: i * zoom }}
              aria-hidden="true"
            />
          ))}
        </div>

        {/* Markers */}
        {sortedMarkers.map((marker) => (
          <MarkerIndicator
            key={marker.id}
            marker={marker}
            zoom={zoom}
            duration={duration}
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
  zoom: number
  duration: number
  currentTime: number
  onClick: () => void
  onDelete: () => void
  onUpdate: (patch: Partial<Marker>) => void
}

function MarkerIndicator({ marker, zoom, duration, currentTime, onClick, onDelete, onUpdate }: MarkerIndicatorProps) {
  const [isDragging, setIsDragging] = useState(false)

  const isCurrent = Math.abs(marker.time - currentTime) < 0.1
  const left = marker.time * zoom

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDragging(true)

    const startX = e.clientX
    const startTime = marker.time

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX
      const dt = dx / zoom
      const newTime = Math.max(0, Math.min(startTime + dt, duration))
      onUpdate({ time: newTime })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [marker.time, zoom, onUpdate, duration])

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
    >
      {/* Marker flag */}
      <div
        className={`absolute top-1 w-3 h-3 rotate-45 transform transition-all cursor-ew-resize ${
          isCurrent
            ? 'ring-2 ring-[var(--ctp-mauve)] ring-offset-1 ring-offset-[var(--ctp-base)]'
            : 'hover:scale-110'
        } ${isDragging ? 'opacity-80' : ''}`}
        style={{
          backgroundColor: marker.color || 'var(--ctp-blue)',
          left: 6,
        }}
        onMouseDown={handleMouseDown}
      />

      {/* Marker label (shown on hover or when current) */}
      {(isCurrent || isDragging) && (
        <div
          className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-[var(--ctp-base)] border border-[var(--ctp-overlay)] shadow-lg whitespace-nowrap z-10"
          style={{ left: 6 }}
        >
          <span className="text-xs text-[var(--ctp-text)]">
            {marker.label || formatTime(marker.time)}
          </span>
        </div>
      )}

      {/* Delete button (shown on hover) */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="absolute -top-5 left-1/2 -translate-x-1/2 p-1 rounded bg-[var(--ctp-red)] text-[var(--ctp-base)] opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ left: 6 }}
        aria-label="Delete marker"
      >
        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Vertical line */}
      <div
        className="absolute top-3 bottom-0 w-px pointer-events-none"
        style={{
          backgroundColor: marker.color || 'var(--ctp-blue)',
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
