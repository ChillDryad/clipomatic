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

export function TimelineTextTrack({
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
  const color = '#f5c2e7' // pink for text

  return (
    <div className="flex">
      {/* Track label */}
      <div
        className="w-48 flex-shrink-0 flex items-center gap-2 px-2 py-2 bg-[var(--ctp-surface)] border-r border-b border-[var(--ctp-overlay)]"
        aria-hidden="true"
      >
        <div
          className="w-6 h-6 rounded flex items-center justify-center bg-[rgba(245,194,231,0.2)] border border-[#f5c2e7]"
        >
          <svg className="w-3.5 h-3.5 text-[#f5c2e7]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </div>
        <span className="text-xs font-medium text-[var(--ctp-text)] truncate flex-1">{track.label}</span>
        <button
          onClick={() => onToggleVisible(track.id)}
          className="flex-shrink-0 p-0.5 rounded hover:bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]"
          aria-label={`Toggle ${track.label} visibility`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>

      {/* Segment area */}
      <div
        className="flex-1 relative h-12 bg-[var(--ctp-surface-1)] border-b border-[var(--ctp-overlay)] cursor-pointer"
        role="application"
        aria-label={`${track.label} text track. Click to seek.`}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left
          const time = x / pxPerSecond
          onSeek(time)
        }}
      >
        {track.segments.map(segment => {
          const left = segment.start * pxPerSecond
          const width = Math.max((segment.end - segment.start) * pxPerSecond, 20)
          const isCurrent = currentTime >= segment.start && currentTime <= segment.end
          const isSelected = selectedSegmentId === segment.id

          return (
            <div
              key={segment.id}
              className={`absolute top-2 h-8 rounded overflow-hidden transition-all flex items-center px-2 ${
                isSelected
                  ? 'ring-2 ring-[var(--ctp-mauve)] ring-offset-1 ring-offset-[var(--ctp-base)]'
                  : isCurrent
                    ? 'opacity-90'
                    : 'hover:opacity-80'
              }`}
              style={{
                left,
                width,
                backgroundColor: `${color}30`,
                border: `1px solid ${color}`,
              }}
              onClick={e => {
                e.stopPropagation()
                onSelectSegment(segment.id)
              }}
            >
              {/* Text preview */}
              <span
                className="text-xs truncate"
                style={{
                  color: segment.fontStyle?.color ?? color,
                  fontWeight: segment.fontStyle?.weight === 'bold' ? 'bold' : 'normal',
                  fontStyle: segment.fontStyle?.style === 'italic' ? 'italic' : 'normal',
                  fontFamily: segment.fontStyle?.family ?? 'sans-serif',
                  fontSize: '10px',
                }}
              >
                {segment.text ?? 'Text annotation'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
