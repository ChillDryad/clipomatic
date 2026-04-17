import { TimelineSegment } from './TimelineSegment'
import type { Track, TrackSegment } from '../../types'

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

export function TimelineOverlayTrack({
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
  const color = '#f9e2af' // yellow for overlays

  return (
    <div className="flex">
      {/* Track label */}
      <div
        className="w-48 flex-shrink-0 flex items-center gap-2 px-2 py-2 bg-[var(--ctp-surface)] border-r border-b border-[var(--ctp-overlay)]"
        aria-hidden="true"
      >
        <div
          className="w-6 h-6 rounded flex items-center justify-center bg-[rgba(249,226,175,0.2)] border border-[#f9e2af]"
        >
          <svg className="w-3.5 h-3.5 text-[#f9e2af]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <span className="text-xs font-medium text-[var(--ctp-text)] truncate flex-1">{track.label}</span>
        <button
          onClick={() => onToggleVisible(track.id)}
          className="flex-shrink-0 p-0.5 rounded hover:bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]"
          aria-label={`Toggle ${track.label} visibility`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>

      {/* Segment area */}
      <div
        className="flex-1 relative h-12 bg-[var(--ctp-surface-1)] border-b border-[var(--ctp-overlay)] cursor-pointer"
        role="application"
        aria-label={`${track.label} overlay track. Click to seek.`}
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

        {/* Overlay type badge */}
        {track.segments.map(segment => {
          if (segment.overlayType) {
            const left = segment.start * pxPerSecond
            const width = Math.max((segment.end - segment.start) * pxPerSecond, 4)
            return (
              <div
                key={`badge-${segment.id}`}
                className="absolute -top-5 text-[10px] px-1.5 py-0.5 rounded bg-[var(--ctp-surface)] text-[var(--ctp-subtext)] border border-[var(--ctp-overlay)]"
                style={{ left }}
              >
                {segment.overlayType === 'video' ? '🎬' : '🖼️'} {segment.overlayType}
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}
