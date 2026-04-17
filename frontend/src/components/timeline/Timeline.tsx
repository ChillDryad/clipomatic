import { useRef } from 'react'
import { TimelineRuler } from './TimelineRuler'
import { TimelineTrack } from './TimelineTrack'
import { TimelineMarkerTrack } from './TimelineMarkerTrack'
import { TimelineOverlayTrack } from './TimelineOverlayTrack'
import { TimelineAudioTrack } from './TimelineAudioTrack'
import { TimelineTextTrack } from './TimelineTextTrack'
import { Playhead } from './Playhead'
import type { TimelineState, TrackSegment, Marker } from '../../types'

interface Props {
  timelineState: TimelineState
  currentTime: number
  selectedSegmentId: string | null
  pxPerSecond: number
  setPxPerSecond?: (n: number) => void
  onSeek: (time: number) => void
  onSelectSegment: (id: string | null) => void
  onUpdateSegment: (trackId: string, segmentId: string, patch: Partial<TrackSegment>) => void
  onDeleteSegment: (trackId: string, segmentId: string) => void
  onToggleVisible: (trackId: string) => void
  markers?: Marker[]
  onAddMarker?: (time: number) => void
  onDeleteMarker?: (markerId: string) => void
  onUpdateMarker?: (markerId: string, patch: Partial<Marker>) => void
  snapEnabled?: boolean
}

export function Timeline({
  timelineState,
  currentTime,
  selectedSegmentId,
  pxPerSecond,
  setPxPerSecond,
  onSeek,
  onSelectSegment,
  onUpdateSegment,
  onDeleteSegment,
  onToggleVisible,
  markers = [],
  onAddMarker,
  onDeleteMarker,
  onUpdateMarker,
  snapEnabled = true,
}: Props) {
  const { tracks, duration } = timelineState
  const trackAreaWidth = Math.max(800, duration * pxPerSecond)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Flatten all segments for snapping calculations
  const allSegments = tracks.flatMap(t => t.segments)

  return (
    <div className="glass-card overflow-x-auto min-w-0" data-playhead-container ref={scrollContainerRef}>
      {/* Ruler + Tracks + Playhead */}
      <div className="relative" style={{ width: trackAreaWidth + 80 }}>
        {/* Ruler row */}
        <div className="flex">
          <div className="w-20 flex-shrink-0 bg-[var(--ctp-surface)] border-b border-r border-[var(--ctp-overlay)]" />
          <TimelineRuler
            duration={duration}
            pxPerSecond={pxPerSecond}
            currentTime={currentTime}
            onSeek={onSeek}
          />
        </div>

        {/* Marker track */}
        <TimelineMarkerTrack
          markers={markers}
          pxPerSecond={pxPerSecond}
          duration={duration}
          currentTime={currentTime}
          onSeek={onSeek}
          onAddMarker={onAddMarker ?? (() => {})}
          onDeleteMarker={onDeleteMarker ?? (() => {})}
          onUpdateMarker={onUpdateMarker ?? (() => {})}
        />

        {/* Track rows - use specialized components for new track types */}
        {tracks.filter(t => t.visible).map(track => {
          const commonProps = {
            key: track.id,
            track,
            selectedSegmentId,
            pxPerSecond,
            currentTime,
            duration,
            snapEnabled,
            allSegments,
            onSelectSegment,
            onUpdateSegment,
            onSeek,
            onToggleVisible,
          }

          // Use specialized track components for new types
          switch (track.type) {
            case 'overlay':
              return <TimelineOverlayTrack {...commonProps} />
            case 'audio':
              return <TimelineAudioTrack {...commonProps} />
            case 'text':
              return <TimelineTextTrack {...commonProps} />
            default:
              // Use generic TimelineTrack for avatar, gameplay, subtitle, marker
              return (
                <TimelineTrack
                  {...commonProps}
                  onUpdateSegment={(trackId, segmentId, patch) => {
                    const t = tracks.find(tr => tr.id === trackId)
                    if (t) {
                      onUpdateSegment(trackId, segmentId, patch)
                    }
                  }}
                />
              )
          }
        })}

        {/* Playhead overlay */}
        <div
          className="absolute top-0 bottom-0 left-[80px] z-20 pointer-events-none"
          style={{ width: trackAreaWidth }}
        >
          <Playhead
            currentTime={currentTime}
            duration={duration}
            trackAreaWidth={trackAreaWidth}
            onSeek={onSeek}
            containerRef={scrollContainerRef}
          />
        </div>
      </div>
    </div>
  )
}
