import { useRef, useCallback } from 'react'
import type { TrackSegment } from '../../types'
import { SNAP_THRESHOLD, applySnap, getAllSnapPoints } from '../../utils/snapping'

interface Props {
  segment: TrackSegment
  isSelected: boolean
  pxPerSecond: number
  color: string
  currentTime: number
  duration: number
  onSelect: () => void
  onUpdate: (patch: Partial<TrackSegment>) => void
  snapEnabled?: boolean
  allSegments?: TrackSegment[]
}

type DragMode = 'move' | 'trim-start' | 'trim-end' | null

// Touch target minimum: 44px. Edge trim handles need at least this hit area.
const EDGE_THRESHOLD = 12

export function TimelineSegment({
  segment,
  isSelected,
  pxPerSecond,
  color,
  currentTime,
  duration,
  onSelect,
  onUpdate,
  snapEnabled = true,
  allSegments = [],
}: Props) {
  const dragMode = useRef<DragMode>(null)
  const dragStartX = useRef(0)
  const dragStartStart = useRef(0)
  const dragStartEnd = useRef(0)
  const snapPointRef = useRef<{ time: number; type: string } | null>(null)

  const startDrag = useCallback((mode: DragMode, clientX: number) => {
    dragMode.current = mode
    dragStartX.current = clientX
    dragStartStart.current = segment.start
    dragStartEnd.current = segment.end
    snapPointRef.current = null

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragMode.current) return
      const dx = e.clientX - dragStartX.current
      const dt = dx / pxPerSecond

      if (dragMode.current === 'move') {
        let newStart = Math.max(0, dragStartStart.current + dt)
        let newEnd = dragStartEnd.current + dt

        // Apply snapping if enabled
        if (snapEnabled) {
          const snapPoints = getAllSnapPoints({
            currentTime,
            segments: allSegments,
            markers: [],
            duration,
          })

          const startSnap = applySnap(newStart, snapPoints, { threshold: SNAP_THRESHOLD })
          if (startSnap.snapped) {
            newStart = startSnap.time
            newEnd = startSnap.time + (segment.end - segment.start)
            snapPointRef.current = { time: startSnap.time, type: startSnap.snapPoint?.type ?? 'playhead' }
          }

          if (!startSnap.snapped) {
            const endSnap = applySnap(newEnd, snapPoints, { threshold: SNAP_THRESHOLD })
            if (endSnap.snapped) {
              newEnd = endSnap.time
              newStart = endSnap.time - (segment.end - segment.start)
              snapPointRef.current = { time: endSnap.time, type: endSnap.snapPoint?.type ?? 'playhead' }
            }
          }
        }

        // Bounds checking
        newStart = Math.max(0, newStart)
        newEnd = Math.min(duration, newEnd)

        if (newEnd > newStart) {
          onUpdate({ start: newStart, end: newEnd })
        }
      } else if (dragMode.current === 'trim-start') {
        let newStart = Math.max(0, Math.min(dragStartStart.current + dt, dragStartEnd.current - 0.1))

        if (snapEnabled) {
          const snapPoints = getAllSnapPoints({
            currentTime,
            segments: allSegments,
            markers: [],
            duration,
          })
          const snap = applySnap(newStart, snapPoints, { threshold: SNAP_THRESHOLD })
          if (snap.snapped) {
            newStart = snap.time
            snapPointRef.current = { time: snap.time, type: snap.snapPoint?.type ?? 'playhead' }
          }
        }

        newStart = Math.max(0, newStart)
        onUpdate({ start: newStart })
      } else if (dragMode.current === 'trim-end') {
        let newEnd = Math.max(dragStartStart.current + 0.1, dragStartEnd.current + dt)

        if (snapEnabled) {
          const snapPoints = getAllSnapPoints({
            currentTime,
            segments: allSegments,
            markers: [],
            duration,
          })
          const snap = applySnap(newEnd, snapPoints, { threshold: SNAP_THRESHOLD })
          if (snap.snapped) {
            newEnd = snap.time
            snapPointRef.current = { time: snap.time, type: snap.snapPoint?.type ?? 'playhead' }
          }
        }

        newEnd = Math.min(duration, newEnd)
        onUpdate({ end: newEnd })
      }
    }

    const handleMouseUp = () => {
      dragMode.current = null
      snapPointRef.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [segment.start, segment.end, pxPerSecond, onUpdate, snapEnabled, currentTime, allSegments, duration])

  const width = (segment.end - segment.start) * pxPerSecond
  const left = segment.start * pxPerSecond

  // Get label based on segment type
  const getLabel = () => {
    switch (segment.type) {
      case 'subtitle':
        return segment.text?.slice(0, 20) ?? 'Subtitle'
      case 'overlay':
        return segment.overlayType === 'video' ? 'Video Overlay' : 'Image Overlay'
      case 'audio':
        return 'Audio Track'
      case 'text':
        return segment.text?.slice(0, 20) ?? 'Text'
      case 'marker':
        return segment.marker?.label ?? 'Marker'
      default:
        return segment.type
    }
  }

  const label = getLabel()
  const isLocked = segment.locked

  return (
    <div
      role="button"
      aria-label={`${segment.type}: ${label || ''} from ${segment.start.toFixed(1)}s to ${segment.end.toFixed(1)}s. ${isSelected ? 'Selected' : ''} ${isLocked ? 'Locked' : ''}`}
      tabIndex={0}
      className={`absolute top-1 bottom-1 rounded cursor-pointer select-none
        transition-all duration-150 ease-out
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ctp-mauve)]
        ${isSelected ? 'ring-2 ring-[var(--ctp-pink)] shadow-lg' : 'hover:ring-1 hover:ring-white/30'}
        ${isLocked ? 'opacity-50' : ''}
      `}
      style={{
        left,
        width,
        backgroundColor: color,
        opacity: isSelected ? 1 : 0.7,
        transform: 'scale(1)',
      }}
      onClick={e => {
        e.stopPropagation()
        onSelect()
      }}
      onMouseDown={e => {
        if (isLocked) return
        const rect = e.currentTarget.getBoundingClientRect()
        const offsetX = e.clientX - rect.left

        if (offsetX < EDGE_THRESHOLD) {
          startDrag('trim-start', e.clientX)
        } else if (offsetX > rect.width - EDGE_THRESHOLD) {
          startDrag('trim-end', e.clientX)
        } else {
          startDrag('move', e.clientX)
        }
        e.preventDefault()
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      {/* Segment label */}
      {width > 60 && (
        <span className="text-[10px] text-[var(--ctp-base)] px-1 truncate block pt-0.5 font-medium select-none">
          {label}
        </span>
      )}

      {/* Lock indicator */}
      {isLocked && (
        <div className="absolute top-1 right-1 text-[var(--ctp-base)]" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
            <path d="M12 1a5 5 0 00-5 5v6a5 5 0 0010 0V6a5 5 0 00-5-5zm3 11a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
        </div>
      )}

      {/* Left trim handle — expanded hit area */}
      {!isLocked && (
        <div
          className="absolute left-0 top-0 bottom-0 w-3 hover:bg-white/40 rounded-l cursor-ew-resize"
          style={{ touchAction: 'none' }}
          aria-hidden="true"
        />
      )}

      {/* Right trim handle — expanded hit area */}
      {!isLocked && (
        <div
          className="absolute right-0 top-0 bottom-0 w-3 hover:bg-white/40 rounded-r cursor-ew-resize"
          style={{ touchAction: 'none' }}
          aria-hidden="true"
        />
      )}
    </div>
  )
}
