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

export function TimelineAudioTrack({
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
  const color = '#94e2d5' // teal for audio

  return (
    <div className="flex">
      {/* Track label */}
      <div
        className="w-48 flex-shrink-0 flex items-center gap-2 px-2 py-2 bg-[var(--ctp-surface)] border-r border-b border-[var(--ctp-overlay)]"
        aria-hidden="true"
      >
        <div
          className="w-6 h-6 rounded flex items-center justify-center bg-[rgba(148,226,213,0.2)] border border-[#94e2d5]"
        >
          <svg className="w-3.5 h-3.5 text-[#94e2d5]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
        <span className="text-xs font-medium text-[var(--ctp-text)] truncate flex-1">{track.label}</span>
        <div className="flex items-center gap-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 text-[var(--ctp-subtext)]">
            <path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14"/>
          </svg>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={track.volume ?? 1}
            onChange={e => {
              const volume = parseFloat(e.target.value)
              onUpdateSegment(track.id, track.segments[0]?.id ?? '', { volume })
            }}
            className="w-16 h-2 bg-[var(--ctp-surface-1)] rounded-lg appearance-none cursor-pointer"
            aria-label={`${track.label} volume`}
          />
        </div>
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

      {/* Segment area with waveform preview */}
      <div
        className="flex-1 relative h-16 bg-[var(--ctp-surface-1)] border-b border-[var(--ctp-overlay)] cursor-pointer"
        role="application"
        aria-label={`${track.label} audio track. Click to seek.`}
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
              className={`absolute top-2 h-12 rounded overflow-hidden transition-all ${
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
              {/* Waveform visualization (simplified bars) */}
              <div className="absolute inset-0 flex items-center justify-center gap-px overflow-hidden">
                {Array.from({ length: Math.floor(width / 2) }).map((_, i) => {
                  const height = Math.random() * 0.8 + 0.2
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-full"
                      style={{
                        backgroundColor: color,
                        height: `${height * 100}%`,
                        opacity: isCurrent ? 0.8 : 0.5,
                      }}
                    />
                  )
                })}
              </div>

              {/* Segment label */}
              <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[10px] truncate bg-black/40 text-white">
                {segment.audioUrl?.split('/').pop() ?? 'Audio'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
