import React, { useRef, useEffect, useCallback } from 'react'
import { usePlaybackStore, useTimelineStore, useSelectionStore } from '../../stores'
import { TimelineRuler } from './OpenCutRuler'
import { TimelineTrackRow } from './OpenCutTrack'
import { TimelinePlayhead } from './OpenCutPlayhead'
import { OpenCutMarkerTrack } from './OpenCutMarkerTrack'
import type { Track } from '../../types'

interface OpenCutTimelineProps {
  tracks: Track[]
  duration: number
  currentTime: number
  onSeek: (time: number) => void
  onSelectSegment: (segmentId: string | null, mode?: 'replace' | 'add') => void
  onUpdateSegment: (trackId: string, segmentId: string, patch: Partial<any>) => void
  onDeleteSegment: (trackId: string, segmentId: string) => void
}

export const TIMELINE_PADDING_LEFT = 60 // Space for track labels
export const TRACK_HEIGHT = 64
export const CLIP_GAP = 2
export const SELECTION_RING_WIDTH = 2

export function OpenCutTimeline({
  tracks,
  duration,
  currentTime,
  onSeek,
  onSelectSegment,
  onUpdateSegment,
  onDeleteSegment,
}: OpenCutTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const zoom = usePlaybackStore(state => state.zoom)
  const snapEnabled = usePlaybackStore(state => state.snapEnabled)
  const selectedSegmentIds = useSelectionStore(state => state.selectedSegmentIds)
  const markers = useTimelineStore(state => state.markers)
  const addMarker = useTimelineStore(state => state.addMarker)
  const deleteMarker = useTimelineStore(state => state.deleteMarker)
  const updateMarker = useTimelineStore(state => state.updateMarker)

  const timelineWidth = Math.max(duration * zoom + TIMELINE_PADDING_LEFT, 1000)

  // Handle wheel zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = -e.deltaY * 0.001
      const newZoom = Math.max(10, Math.min(500, zoom + delta * 50))
      usePlaybackStore.getState().setZoom(newZoom)
    }
  }, [zoom])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // Scroll to follow playhead
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const playheadX = currentTime * zoom + TIMELINE_PADDING_LEFT
    const scrollLeft = container.scrollLeft
    const scrollWidth = container.clientWidth

    if (playheadX < scrollLeft || playheadX > scrollLeft + scrollWidth) {
      container.scrollLeft = playheadX - scrollWidth / 2
    }
  }, [currentTime, zoom])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current || e.target === containerRef.current?.querySelector('.timeline-tracks')) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        const clickX = e.clientX - rect.left - TIMELINE_PADDING_LEFT + containerRef.current.scrollLeft
        const clickTime = clickX / zoom
        if (clickTime >= 0 && clickTime <= duration) {
          onSeek(clickTime)
        }
      }
    }
  }, [zoom, duration, onSeek])

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-[var(--ctp-base)] relative select-none"
      onClick={handleClick}
    >
      <div className="relative" style={{ width: timelineWidth, height: tracks.length * TRACK_HEIGHT + 40 }}>
        {/* Ruler */}
        <div className="sticky top-0 z-20 bg-[var(--ctp-surface)] border-b border-[var(--ctp-overlay)]">
          <TimelineRuler
            duration={duration}
            zoom={zoom}
            onSeek={onSeek}
          />
        </div>

        {/* Marker Track */}
        <div className="sticky top-[32px] z-10 bg-[var(--ctp-surface)]/95 backdrop-blur">
          <OpenCutMarkerTrack
            markers={markers}
            zoom={zoom}
            duration={duration}
            currentTime={currentTime}
            onSeek={onSeek}
            onAddMarker={(time) => addMarker({ id: crypto.randomUUID(), time, label: '', color: '#89b4fa' })}
            onDeleteMarker={deleteMarker}
            onUpdateMarker={updateMarker}
          />
        </div>

        {/* Tracks */}
        <div className="timeline-tracks relative">
          {tracks.map((track, index) => (
            <TimelineTrackRow
              key={track.id}
              track={track}
              index={index}
              zoom={zoom}
              snapEnabled={snapEnabled}
              onSelectSegment={onSelectSegment}
              onUpdateSegment={onUpdateSegment}
              onDeleteSegment={onDeleteSegment}
            />
          ))}
        </div>

        {/* Playhead */}
        <TimelinePlayhead
          currentTime={currentTime}
          zoom={zoom}
          duration={duration}
        />
      </div>
    </div>
  )
}
