import { create } from 'zustand'

interface PlaybackState {
  currentTime: number
  isPlaying: boolean
  zoom: number  // pxPerSecond
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

const INITIAL_STATE: PlaybackState = {
  currentTime: 0,
  isPlaying: false,
  zoom: 50,  // default px per second
  snapEnabled: true,

  seek: () => {},
  play: () => {},
  pause: () => {},
  togglePlay: () => {},
  toggleSnap: () => {},
  setZoom: () => {},
  stepForward: () => {},
  stepBackward: () => {},
  reset: () => {},
}

export const usePlaybackStore = create<PlaybackState>()((set) => ({
  ...INITIAL_STATE,

  seek: (time) => {
    set({ currentTime: Math.max(0, time) })
  },

  play: () => {
    set({ isPlaying: true })
  },

  pause: () => {
    set({ isPlaying: false })
  },

  togglePlay: () => {
    set(state => ({ isPlaying: !state.isPlaying }))
  },

  toggleSnap: () => {
    set(state => ({ snapEnabled: !state.snapEnabled }))
  },

  setZoom: (zoom) => {
    set({ zoom: Math.max(10, Math.min(500, zoom)) })  // clamp between 10-500 px/s
  },

  stepForward: (seconds = 0.5) => {
    set(state => ({
      currentTime: state.currentTime + seconds,
    }))
  },

  stepBackward: (seconds = 0.5) => {
    set(state => ({
      currentTime: Math.max(0, state.currentTime - seconds),
    }))
  },

  reset: () => {
    set(INITIAL_STATE)
  },
}))

// Snapping helper - to be expanded in snapping.ts
export const SNAP_THRESHOLD = 0.16  // ~5 frames at 30fps

export function applySnap(
  time: number,
  snapPoints: number[],
  threshold: number = SNAP_THRESHOLD
): { time: number; snapped: boolean; snapPoint?: number } {
  for (const point of snapPoints) {
    if (Math.abs(time - point) < threshold) {
      return { time: point, snapped: true, snapPoint: point }
    }
  }
  return { time, snapped: false }
}

export function getSnapPoints(
  currentTime: number,
  duration: number,
  segments: Array<{ start: number; end: number }>,
  markers: Array<{ time: number }>,
  includePlayhead: boolean = true
): number[] {
  const points: number[] = []

  // Add playhead
  if (includePlayhead) {
    points.push(currentTime)
  }

  // Add segment edges
  for (const seg of segments) {
    points.push(seg.start)
    points.push(seg.end)
  }

  // Add markers
  for (const marker of markers) {
    points.push(marker.time)
  }

  // Add 0 and duration
  points.push(0)
  points.push(duration)

  // Remove duplicates and sort
  return [...new Set(points)].sort((a, b) => a - b)
}
