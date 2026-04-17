import { useState, useCallback } from 'react'
import type { Track } from '../../types'
import { TimelineTrack } from './TimelineTrack'

interface TrackGroup {
  id: string
  name: string
  tracks: Track[]
  defaultCollapsed?: boolean
  color?: string
}

interface Props {
  group: TrackGroup
  pxPerSecond: number
  currentTime: number
  selectedSegmentId: string | null
  onSelectSegment: (id: string | null) => void
  onUpdateSegment: (trackId: string, segmentId: string, patch: { start?: number; end?: number; locked?: boolean; text?: string; cropBox?: Track['segments'][0]['cropBox']; style?: Track['segments'][0]['style'] }) => void
  onDeleteSegment: (trackId: string, segmentId: string) => void
  onToggleVisible: (trackId: string) => void
  onSeek: (time: number) => void
  duration: number
  onGroupCollapse?: (groupId: string, collapsed: boolean) => void
  onTrackHeightChange?: (trackId: string, height: number) => void
}

export function CollapsibleTrackGroup({
  group,
  pxPerSecond,
  currentTime,
  selectedSegmentId,
  onSelectSegment,
  onUpdateSegment,
  onDeleteSegment,
  onToggleVisible,
  onSeek,
  duration,
  onGroupCollapse,
  onTrackHeightChange,
}: Props) {
  const [isCollapsed, setIsCollapsed] = useState(group.defaultCollapsed || false)
  const [trackHeights, setTrackHeights] = useState<Record<string, number>>({})

  const handleToggleCollapse = useCallback(() => {
    const newState = !isCollapsed
    setIsCollapsed(newState)
    onGroupCollapse?.(group.id, newState)
  }, [isCollapsed, group.id, onGroupCollapse])

  const handleTrackHeightChange = useCallback((trackId: string, height: number) => {
    setTrackHeights(prev => ({ ...prev, [trackId]: height }))
    onTrackHeightChange?.(trackId, height)
  }, [onTrackHeightChange])

  return (
    <div className="border-l-2 border-[var(--ctp-surface)]" style={{ borderColor: group.color || 'var(--ctp-surface)' }}>
      {/* Group header */}
      <div
        className="flex items-center gap-2 px-2 py-1.5 bg-[var(--ctp-surface)] border-b border-[var(--ctp-overlay)] cursor-pointer hover:bg-[var(--ctp-surface-1)] transition-colors"
        onClick={handleToggleCollapse}
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        aria-label={`${group.name} track group. Click to ${isCollapsed ? 'expand' : 'collapse'}.`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleToggleCollapse()
          }
        }}
      >
        {/* Collapse arrow */}
        <svg
          className={`w-4 h-4 text-[var(--ctp-subtext)] transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>

        {/* Group color indicator */}
        {group.color && (
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: group.color }}
            aria-hidden="true"
          />
        )}

        {/* Group name */}
        <span className="text-xs font-semibold text-[var(--ctp-text)]">{group.name}</span>

        {/* Track count */}
        <span className="text-[10px] text-[var(--ctp-subtext)] bg-[var(--ctp-surface-1)] px-1.5 py-0.5 rounded-full">
          {group.tracks.length}
        </span>

        {/* Group actions */}
        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation()
              // Expand all tracks
              group.tracks.forEach(track => {
                if (!track.visible) onToggleVisible(track.id)
              })
            }}
            className="p-1 rounded hover:bg-[var(--ctp-surface-1)]"
            aria-label="Show all tracks in group"
            title="Show all"
          >
            <svg className="w-3.5 h-3.5 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              // Hide all tracks
              group.tracks.forEach(track => {
                if (track.visible) onToggleVisible(track.id)
              })
            }}
            className="p-1 rounded hover:bg-[var(--ctp-surface-1)]"
            aria-label="Hide all tracks in group"
            title="Hide all"
          >
            <svg className="w-3.5 h-3.5 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.025m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tracks (when expanded) */}
      {!isCollapsed && (
        <div className="divide-y divide-[var(--ctp-overlay)]">
          {group.tracks.map((track) => (
            <TimelineTrack
              key={track.id}
              track={track}
              selectedSegmentId={selectedSegmentId}
              pxPerSecond={pxPerSecond}
              currentTime={currentTime}
              duration={duration}
              onSelectSegment={onSelectSegment}
              onUpdateSegment={onUpdateSegment}
              onSeek={onSeek}
              onToggleVisible={onToggleVisible}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Predefined track groups for common use cases.
 */
export const TRACK_GROUP_PRESETS: Record<string, Omit<TrackGroup, 'tracks'>> = {
  video: {
    id: 'video',
    name: 'Video Tracks',
    color: '#89b4fa',
    defaultCollapsed: false,
  },
  audio: {
    id: 'audio',
    name: 'Audio Tracks',
    color: '#f38ba8',
    defaultCollapsed: false,
  },
  overlays: {
    id: 'overlays',
    name: 'Overlays & Text',
    color: '#fab387',
    defaultCollapsed: false,
  },
  markers: {
    id: 'markers',
    name: 'Markers',
    color: '#cba6f7',
    defaultCollapsed: false,
  },
}

/**
 * Groups tracks by type.
 */
export function groupTracksByType(tracks: Track[]): Record<string, Track[]> {
  const groups: Record<string, Track[]> = {}

  tracks.forEach(track => {
    const groupKey = track.type === 'avatar' || track.type === 'gameplay'
      ? 'video'
      : track.type === 'audio'
      ? 'audio'
      : 'overlays'

    if (!groups[groupKey]) {
      groups[groupKey] = []
    }
    groups[groupKey].push(track)
  })

  return groups
}
