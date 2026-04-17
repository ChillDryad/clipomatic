import { useCallback, useRef, useState } from 'react'
import type { TrackSegment } from '../../types'

export type DragMode = 'move' | 'trim-start' | 'trim-end' | 'ripple-move' | null

interface SegmentHandleProps {
  position: 'left' | 'right'
  onDragStart: (mode: DragMode, startX: number) => void
  isHovered: boolean
}

function SegmentHandle({ position, onDragStart, isHovered }: SegmentHandleProps) {
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDragStart(position === 'left' ? 'trim-start' : 'trim-end', e.clientX)
  }, [onDragStart, position])

  return (
    <div
      className={`absolute top-0 bottom-0 w-4 cursor-ew-resize transition-colors ${
        position === 'left' ? 'left-0 rounded-l' : 'right-0 rounded-r'
      } ${
        isHovered
          ? 'bg-white/30'
          : 'bg-transparent hover:bg-white/20'
      }`}
      onMouseDown={handleMouseDown}
      aria-hidden="true"
      style={{ touchAction: 'none' }}
    >
      {/* Visual handle indicator */}
      <div className="absolute top-1/2 -translate-y-1/2 w-1 h-6 bg-white/40 rounded-full" />
    </div>
  )
}

interface Props {
  segment: TrackSegment
  isSelected: boolean
  pxPerSecond: number
  color: string
  currentTime: number
  duration: number
  onSelect: () => void
  onUpdate: (patch: { start?: number; end?: number }) => void
  onDragStart?: (mode: DragMode, startX: number, start: number, end: number) => void
  rippleEnabled?: boolean
}

export function SegmentHandles({
  segment,
  isSelected,
  pxPerSecond,
  color,
  currentTime,
  duration,
  onSelect,
  onUpdate,
  onDragStart,
  rippleEnabled = false,
}: Props) {
  const dragMode = useRef<DragMode>(null)
  const dragStartX = useRef(0)
  const dragStartStart = useRef(0)
  const dragStartEnd = useRef(0)
  const [hoveredHandle, setHoveredHandle] = useState<'left' | 'right' | null>(null)

  const startDrag = useCallback((mode: DragMode, clientX: number) => {
    dragMode.current = mode
    dragStartX.current = clientX
    dragStartStart.current = segment.start
    dragStartEnd.current = segment.end

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragMode.current) return

      const dx = e.clientX - dragStartX.current
      const dt = dx / pxPerSecond
      const SNAP_THRESHOLD = 0.1 // ~3 frames at 30fps

      // Snap points
      const snapPoints: { time: number; type: string }[] = [
        { time: currentTime, type: 'playhead' },
        { time: 0, type: 'start' },
        { time: duration, type: 'end' },
      ]

      const snapTo = (time: number): number => {
        for (const point of snapPoints) {
          if (Math.abs(time - point.time) < SNAP_THRESHOLD) {
            return point.time
          }
        }
        return time
      }

      if (mode === 'move' || mode === 'ripple-move') {
        let newStart = Math.max(0, dragStartStart.current + dt)
        let newEnd = dragStartEnd.current + dt

        // Apply snapping
        newStart = snapTo(newStart)
        newEnd = snapTo(newEnd)

        // Clamp to duration
        newStart = Math.max(0, newStart)
        newEnd = Math.min(duration, newEnd)

        // Ensure valid segment
        if (newEnd > newStart + 0.1) {
          onUpdate({ start: newStart, end: newEnd })
        }
      } else if (mode === 'trim-start') {
        let newStart = Math.max(0, dragStartStart.current + dt)
        newStart = snapTo(newStart)
        newStart = Math.max(0, Math.min(newStart, dragStartEnd.current - 0.1))
        onUpdate({ start: newStart })
      } else if (mode === 'trim-end') {
        let newEnd = Math.max(dragStartStart.current + 0.1, dragStartEnd.current + dt)
        newEnd = snapTo(newEnd)
        newEnd = Math.min(duration, newEnd)
        onUpdate({ end: newEnd })
      }
    }

    const handleMouseUp = () => {
      dragMode.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [segment.start, segment.end, pxPerSecond, currentTime, duration, onUpdate])

  const width = (segment.end - segment.start) * pxPerSecond
  const left = segment.start * pxPerSecond
  const isSubtitle = segment.type === 'subtitle'
  const label = isSubtitle ? segment.text?.slice(0, 30) : segment.type
  const minSegmentWidth = 20 // Minimum visual width for a segment

  // Don't render if too small
  if (width < 1) return null

  return (
    <div
      role="button"
      aria-label={`${isSubtitle ? 'Subtitle' : 'Segment'}: ${label || ''} from ${segment.start.toFixed(1)}s to ${segment.end.toFixed(1)}s. ${isSelected ? 'Selected' : ''}`}
      tabIndex={segment.locked ? -1 : 0}
      className={`absolute top-1 bottom-1 rounded cursor-pointer select-none
        transition-all duration-150 ease-out
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ctp-mauve)] focus-visible:outline-offset-2
        ${isSelected ? 'ring-2 ring-[var(--ctp-mauve)] shadow-lg' : 'hover:ring-1 hover:ring-white/30'}
        ${segment.locked ? 'opacity-60 cursor-not-allowed' : ''}
      `}
      style={{
        left,
        width: Math.max(width, minSegmentWidth),
        backgroundColor: color,
        opacity: isSelected ? 1 : 0.8,
        transform: isSelected ? 'scale(1.02)' : 'scale(1)',
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (!segment.locked) onSelect()
      }}
      onMouseDown={(e) => {
        if (segment.locked) return
        e.stopPropagation()

        const rect = e.currentTarget.getBoundingClientRect()
        const offsetX = e.clientX - rect.left
        const handleWidth = 12 // px

        if (offsetX < handleWidth) {
          startDrag('trim-start', e.clientX)
        } else if (offsetX > rect.width - handleWidth) {
          startDrag('trim-end', e.clientX)
        } else {
          startDrag(rippleEnabled ? 'ripple-move' : 'move', e.clientX)
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      onMouseEnter={() => {}}
      onMouseLeave={() => setHoveredHandle(null)}
    >
      {/* Segment label */}
      {width > 50 && (
        <span className="text-[10px] text-[var(--ctp-base)] px-2 py-0.5 truncate block font-medium select-none pointer-events-none">
          {label}
        </span>
      )}

      {/* Time tooltip during drag */}
      {dragMode.current && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] bg-[var(--ctp-base)] text-[var(--ctp-text)] px-2 py-0.5 rounded font-mono whitespace-nowrap shadow-lg pointer-events-none">
          {segment.start.toFixed(2)}s - {segment.end.toFixed(2)}s
        </div>
      )}

      {/* Left trim handle */}
      {!segment.locked && (
        <SegmentHandle
          position="left"
          onDragStart={(mode, x) => startDrag(mode, x)}
          isHovered={hoveredHandle === 'left'}
        />
      )}

      {/* Right trim handle */}
      {!segment.locked && (
        <SegmentHandle
          position="right"
          onDragStart={(mode, x) => startDrag(mode, x)}
          isHovered={hoveredHandle === 'right'}
        />
      )}

      {/* Ripple indicator (when ripple mode is enabled and segment will be affected) */}
      {rippleEnabled && isSelected && (
        <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-[var(--ctp-mauve)] rounded-full animate-pulse" />
      )}
    </div>
  )
}
