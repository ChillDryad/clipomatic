import type { TimelineState, Track, TrackSegment, Clip, Marker } from '../types'

// Timeline Store types
export interface TimelineStore extends TimelineState {
  // Undo/redo stacks
  undoStack: Partial<TimelineState>[]
  redoStack: Partial<TimelineState>[]

  // Core actions
  initializeTimeline: (clip: Clip, videoPath: string, videoDimensions: { w: number; h: number }) => void
  addTrack: (track: Track) => void
  removeTrack: (trackId: string) => void
  updateTrack: (trackId: string, patch: Partial<Track>) => void
  updateSegment: (trackId: string, segmentId: string, patch: Partial<TrackSegment>) => void
  deleteSegment: (trackId: string, segmentId: string) => void
  addSegment: (trackId: string, segment: TrackSegment) => void
  updateCropBox: (trackType: 'avatar' | 'gameplay', cropBox: import('../types').CropBox) => void
  pushUndo: () => void
  undo: () => void
  redo: () => void
  resetTimeline: () => void
  canUndo: boolean
  canRedo: boolean
}

// Playback Store types
export interface PlaybackStore {
  currentTime: number
  isPlaying: boolean
  zoom: number
  snapEnabled: boolean

  // Actions
  seek: (time: number) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  toggleSnap: () => void
  setZoom: (zoom: number) => void
  stepForward: (seconds?: number) => void
  stepBackward: (seconds?: number) => void
  reset: () => void
}

// Selection Store types
export interface SelectionStore {
  selectedSegmentIds: Set<string>
  selectedTrackIds: Set<string>

  // Actions
  select: (segmentId: string, mode?: 'replace' | 'add' | 'range') => void
  selectTrack: (trackId: string, mode?: 'replace' | 'add') => void
  clearSelection: () => void
  deleteSelected: () => void
  duplicateSelected: () => void
  isSelected: (segmentId: string) => boolean
  isTrackSelected: (trackId: string) => boolean
  selectedCount: number
  reset: () => void
}
