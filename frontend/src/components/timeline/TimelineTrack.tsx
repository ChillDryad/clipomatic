import { TimelineSegment } from './TimelineSegment'
import type { Track, TrackSegment } from '../../types'

const TRACK_COLORS: Record<string, string> = {
  avatar: '#89b4fa',
  gameplay: '#cba6f7',
  subtitle: '#a6e3a1',
  overlay: '#f9e2af',
  audio: '#94e2d5',
  text: '#f5c2e7',
  marker: '#fab387',
}

interface Props {
  track: Track
  selectedSegmentId: string | null
  pxPerSecond: number
  currentTime: number
  duration: number
  snapEnabled?: boolean
  allSegments?: TrackSegment[]
  onSelectSegment: (id: string | null) => void
  onUpdateSegment: (trackId: string, segmentId: string, patch: Partial<TrackSegment>) => void
  onSeek: (time: number) => void
  onToggleVisible: (trackId: string) => void
}

export function TimelineTrack({
  track,
  selectedSegmentId,
  pxPerSecond,
  currentTime,
  duration,
  snapEnabled = true,
  allSegments = [],
  onSelectSegment,
  onUpdateSegment,
  onSeek,
  onToggleVisible,
}: Props) {
  const color = TRACK_COLORS[track.type] ?? '#888'

  return (
    <div className="flex">
      {/* Track label */}
      <div
        className="w-20 flex-shrink-0 flex items-center gap-1 px-2 bg-[var(--ctp-surface)] border-r border-[var(--ctp-overlay)]"
        aria-hidden="true"
      >
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs text-[var(--ctp-subtext)] truncate flex-1">{track.label}</span>
        <button
          onClick={() => onToggleVisible(track.id)}
          className="flex-shrink-0 p-0.5 rounded hover:bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]"
          aria-label={`Toggle ${track.label} visibility`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>

      {/* Segment area */}
      <div
        className="flex-1 relative h-12 bg-[var(--ctp-surface-1)] cursor-pointer"
        role="application"
        aria-label={`${track.label} track. Click to seek.`}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left
          const time = x / pxPerSecond
          onSeek(time)
        }}
      >
        {track.segments.map(segment => (
          <TimelineSegment
            key={segment.id}
            segment={segment}
            isSelected={selectedSegmentId === segment.id}
            pxPerSecond={pxPerSecond}
            color={color}
            currentTime={currentTime}
            duration={duration}
            snapEnabled={snapEnabled}
            allSegments={allSegments}
            onSelect={() => onSelectSegment(segment.id)}
            onUpdate={patch => onUpdateSegment(track.id, segment.id, patch)}
          />
        ))}
      </div>
    </div>
  )
}
