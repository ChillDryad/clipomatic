import React, { useCallback } from 'react'
import { useSelectionStore } from '../../stores'
import { OpenCutClip } from './OpenCutClip'
import { TRACK_HEIGHT } from './OpenCutTimeline'
import type { Track, TrackSegment } from '../../types'

interface TimelineTrackRowProps {
  track: Track
  index: number
  zoom: number
  snapEnabled: boolean
  onSelectSegment: (segmentId: string | null, mode?: 'replace' | 'add') => void
  onUpdateSegment: (trackId: string, segmentId: string, patch: Partial<TrackSegment>) => void
  onDeleteSegment: (trackId: string, segmentId: string) => void
}

export function TimelineTrackRow({
  track,
  index,
  zoom,
  snapEnabled,
  onSelectSegment,
  onUpdateSegment,
  onDeleteSegment,
}: TimelineTrackRowProps) {
  const selectedSegmentIds = useSelectionStore(state => state.selectedSegmentIds)

  const handleTrimStart = useCallback((side: 'left' | 'right', startTime: number) => {
    // Could set snapping state here
  }, [])

  const handleTrimMove = useCallback((deltaTime: number, side: 'left' | 'right', segment: TrackSegment) => {
    let newTime = side === 'left' ? segment.start + deltaTime : segment.end + deltaTime

    // Apply snap if enabled
    if (snapEnabled) {
      const snapThreshold = 0.16 // ~5 frames at 30fps
      const snapPoints = [0, 5, 10, 15, 30, 60] // Common time points
      for (const snapPoint of snapPoints) {
        if (Math.abs(newTime - snapPoint) < snapThreshold) {
          newTime = snapPoint
          break
        }
      }
    }

    // Ensure valid segment (min duration 0.1s)
    if (side === 'left' && newTime >= segment.end - 0.1) {
      newTime = segment.end - 0.1
    }
    if (side === 'right' && newTime <= segment.start + 0.1) {
      newTime = segment.start + 0.1
    }

    // Ensure non-negative
    if (newTime < 0) newTime = 0

    onUpdateSegment(track.id, segment.id, {
      [side === 'left' ? 'start' : 'end']: newTime,
    })
  }, [snapEnabled, track.id, onUpdateSegment])

  const handleDragStart = useCallback((startTime: number) => {
    // Could set dragging state here
  }, [])

  const handleDragMove = useCallback((deltaTime: number, segment: TrackSegment) => {
    let newStart = segment.start + deltaTime
    let newEnd = segment.end + deltaTime

    // Apply snap if enabled
    if (snapEnabled) {
      const snapThreshold = 0.16
      const snapPoints = [0, 5, 10, 15, 30, 60]

      // Snap start or end, whichever is closer
      for (const snapPoint of snapPoints) {
        if (Math.abs(newStart - snapPoint) < snapThreshold) {
          const offset = snapPoint - newStart
          newStart = snapPoint
          newEnd = segment.end + offset
          break
        }
        if (Math.abs(newEnd - snapPoint) < snapThreshold) {
          const offset = snapPoint - newEnd
          newEnd = snapPoint
          newStart = segment.start + offset
          break
        }
      }
    }

    // Ensure non-negative
    if (newStart < 0) {
      newEnd -= newStart
      newStart = 0
    }

    onUpdateSegment(track.id, segment.id, {
      start: newStart,
      end: newEnd,
    })
  }, [snapEnabled, track.id, onUpdateSegment])

  const handleDragEnd = useCallback(() => {
    // Could clear dragging state here
  }, [])

  const handleTrimEnd = useCallback(() => {
    // Could clear trimming state here
  }, [])

  const hasSelectedSegment = track.segments.some(s => selectedSegmentIds.has(s.id))

  return (
    <div
      className={`relative border-b border-[var(--ctp-overlay)] ${
        hasSelectedSegment ? 'bg-[var(--ctp-mauve)]/10' : ''
      }`}
      style={{ height: TRACK_HEIGHT }}
    >
      {/* Track label */}
      <div
        className="absolute left-0 top-0 bottom-0 flex items-center px-2 border-r border-[var(--ctp-overlay)] bg-[var(--ctp-surface)]"
        style={{ width: 60 }}
      >
        <span className="text-xs text-[var(--ctp-subtext)] truncate">
          {track.label || `Track ${index + 1}`}
        </span>
      </div>

      {/* Track content area */}
      <div className="absolute left-[60px] right-0 top-0 bottom-0">
        {/* Segments */}
        {track.segments.map((segment) => (
          <OpenCutClip
            key={segment.id}
            segment={segment}
            zoom={zoom}
            trackHeight={TRACK_HEIGHT}
            isSelected={selectedSegmentIds.has(segment.id)}
            onSelect={(e, mode) => onSelectSegment(segment.id, mode)}
            onTrimStart={handleTrimStart}
            onTrimMove={(deltaTime, side) => handleTrimMove(deltaTime, side, segment)}
            onTrimEnd={handleTrimEnd}
            onDragStart={handleDragStart}
            onDragMove={(deltaTime) => handleDragMove(deltaTime, segment)}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>
    </div>
  )
}
