import React, { useCallback, useRef } from 'react'
import { TrimHandle, TRIM_HANDLE_WIDTH } from './TrimHandle'
import type { TrackSegment } from '../../types'

interface OpenCutClipProps {
  segment: TrackSegment
  zoom: number
  trackHeight: number
  isSelected: boolean
  onSelect: (e: React.MouseEvent, mode?: 'replace' | 'add') => void
  onTrimStart: (side: 'left' | 'right', startTime: number) => void
  onTrimMove: (deltaTime: number, side: 'left' | 'right') => void
  onTrimEnd: () => void
  onDragStart: (startTime: number) => void
  onDragMove: (deltaTime: number) => void
  onDragEnd: () => void
}

export function OpenCutClip({
  segment,
  zoom,
  trackHeight,
  isSelected,
  onSelect,
  onTrimStart,
  onTrimMove,
  onTrimEnd,
  onDragStart,
  onDragMove,
  onDragEnd,
}: OpenCutClipProps) {
  const isDragging = useRef(false)
  const dragStartTime = useRef(0)
  const dragStartX = useRef(0)

  // Calculate clip position and width
  const left = segment.start * zoom
  const width = (segment.end - segment.start) * zoom

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Don't start drag if clicking on trim handles
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    if (x < TRIM_HANDLE_WIDTH || x > width - TRIM_HANDLE_WIDTH) {
      return
    }

    e.stopPropagation()
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartTime.current = segment.start

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return
      const deltaX = moveEvent.clientX - dragStartX.current
      const deltaTime = deltaX / zoom
      onDragMove(deltaTime)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      onDragEnd()
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    onDragStart(segment.start)
  }, [segment.start, segment.end, zoom, onDragStart, onDragMove, onDragEnd, width])

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(e, e.ctrlKey || e.metaKey ? 'add' : 'replace')
  }, [onSelect])

  return (
    <div
      className={`absolute top-2 bottom-2 rounded overflow-hidden cursor-pointer transition-colors
        ${isSelected
          ? 'bg-[var(--ctp-blue)] ring-2 ring-[var(--ctp-mauve)]'
          : 'bg-[var(--ctp-surface)] hover:bg-[var(--ctp-overlay)]'
        }`}
      style={{
        left,
        width: Math.max(width - 2, 1), // CLIP_GAP
      }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      {/* Clip content */}
      <div className="px-2 py-1 overflow-hidden">
        <div className="text-xs text-[var(--ctp-text)] font-medium truncate">
          {segment.text || `Segment ${segment.id.slice(0, 4)}`}
        </div>
        <div className="text-[10px] text-[var(--ctp-subtext)]">
          {segment.start.toFixed(2)}s - {segment.end.toFixed(2)}s
        </div>
      </div>

      {/* Trim handles */}
      <TrimHandle
        side="left"
        zoom={zoom}
        onTrimStart={onTrimStart}
        onTrimMove={onTrimMove}
        onTrimEnd={onTrimEnd}
      />
      <TrimHandle
        side="right"
        zoom={zoom}
        onTrimStart={onTrimStart}
        onTrimMove={onTrimMove}
        onTrimEnd={onTrimEnd}
      />
    </div>
  )
}
