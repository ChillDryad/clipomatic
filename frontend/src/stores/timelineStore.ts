import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { TimelineState, Track, TrackSegment, Clip, CropBox, Marker } from '../types'

// Unique ID generator
function uid(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Default track factories
function createAvatarTrack(duration: number, videoDimensions: { w: number; h: number }): Track {
  return {
    id: uid(),
    type: 'avatar',
    label: 'Avatar',
    segments: [{
      id: uid(),
      start: 0,
      end: duration,
      type: 'crop',
      locked: false,
      cropBox: defaultAvatarCrop(videoDimensions),
    }],
    visible: true,
    locked: false,
    volume: 1.0,
    opacity: 1.0,
    collapsed: false,
  }
}

function createGameplayTrack(duration: number, videoDimensions: { w: number; h: number }): Track {
  return {
    id: uid(),
    type: 'gameplay',
    label: 'Gameplay',
    segments: [{
      id: uid(),
      start: 0,
      end: duration,
      type: 'crop',
      locked: false,
      cropBox: defaultGameplayCrop(videoDimensions),
    }],
    visible: true,
    locked: false,
    volume: 1.0,
    opacity: 1.0,
    collapsed: false,
  }
}

function createSubtitleTrack(duration: number): Track {
  return {
    id: uid(),
    type: 'subtitle',
    label: 'Subtitles',
    segments: [],
    visible: true,
    locked: false,
    volume: 1.0,
    opacity: 1.0,
    collapsed: false,
  }
}

function defaultAvatarCrop(dims: { w: number; h: number }): CropBox {
  return {
    x: Math.floor(dims.w * 0.6),
    y: Math.floor(dims.h * 0.5),
    w: Math.floor(dims.w * 0.35),
    h: Math.floor(dims.h * 0.45),
  }
}

function defaultGameplayCrop(dims: { w: number; h: number }): CropBox {
  return { x: 0, y: 0, w: dims.w, h: dims.h }
}

// Timeline state interface
interface TimelineStore extends TimelineState {
  // Markers state
  markers: Marker[]

  // Undo/redo stacks
  undoStack: Partial<TimelineState & { markers: Marker[] }>[]
  redoStack: Partial<TimelineState & { markers: Marker[] }>[]

  // Core actions
  initializeTimeline: (clip: Clip, videoPath: string, videoDimensions: { w: number; h: number }) => void
  setVideoPath: (videoPath: string) => void
  addTrack: (track: Track) => void
  removeTrack: (trackId: string) => void
  updateTrack: (trackId: string, patch: Partial<Track>) => void
  updateSegment: (trackId: string, segmentId: string, patch: Partial<TrackSegment>) => void
  deleteSegment: (trackId: string, segmentId: string) => void
  addSegment: (trackId: string, segment: TrackSegment) => void

  // Crop actions
  updateCropBox: (trackType: 'avatar' | 'gameplay', cropBox: CropBox) => void

  // Marker actions
  addMarker: (marker: Marker) => void
  deleteMarker: (markerId: string) => void
  updateMarker: (markerId: string, patch: Partial<Marker>) => void

  // Undo/redo actions
  pushUndo: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean

  // Utility
  resetTimeline: () => void
}

const INITIAL_STATE: Omit<TimelineStore, 'initializeTimeline' | 'setVideoPath' | 'addTrack' | 'removeTrack' | 'updateTrack' | 'updateSegment' | 'deleteSegment' | 'addSegment' | 'updateCropBox' | 'addMarker' | 'deleteMarker' | 'updateMarker' | 'pushUndo' | 'undo' | 'redo' | 'resetTimeline'> = {
  clip: {
    id: '',
    title: '',
    start: 0,
    end: 0,
    reason: '',
    virality_score: 0,
    brand_alignment: [],
    hashtags: [],
  },
  tracks: [],
  duration: 0,
  videoPath: '',
  videoDimensions: { w: 1920, h: 1080 },
  markers: [],
  undoStack: [],
  redoStack: [],
  canUndo: false,
  canRedo: false,
}

export const useTimelineStore = create<TimelineStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      initializeTimeline: (clip, videoPath, videoDimensions) => {
        const duration = clip.end - clip.start
        set({
          clip,
          videoPath,
          videoDimensions,
          duration,
          tracks: [
            createAvatarTrack(duration, videoDimensions),
            createGameplayTrack(duration, videoDimensions),
            createSubtitleTrack(duration),
          ],
          undoStack: [],
          redoStack: [],
          canUndo: false,
          canRedo: false,
        })
      },

      setVideoPath: (videoPath) => {
        set({ videoPath })
      },

      addTrack: (track) => {
        set(state => ({
          tracks: [...state.tracks, track],
        }))
      },

      removeTrack: (trackId) => {
        set(state => ({
          tracks: state.tracks.filter(t => t.id !== trackId),
        }))
      },

      updateTrack: (trackId, patch) => {
        set(state => ({
          tracks: state.tracks.map(t =>
            t.id === trackId ? { ...t, ...patch } : t
          ),
        }))
      },

      updateSegment: (trackId, segmentId, patch) => {
        set(state => ({
          tracks: state.tracks.map(t =>
            t.id === trackId
              ? {
                  ...t,
                  segments: t.segments.map(s =>
                    s.id === segmentId ? { ...s, ...patch } : s
                  ),
                }
              : t
          ),
        }))
      },

      deleteSegment: (trackId, segmentId) => {
        set(state => ({
          tracks: state.tracks.map(t =>
            t.id === trackId
              ? { ...t, segments: t.segments.filter(s => s.id !== segmentId) }
              : t
          ),
        }))
      },

      addSegment: (trackId, segment) => {
        set(state => ({
          tracks: state.tracks.map(t =>
            t.id === trackId ? { ...t, segments: [...t.segments, segment] } : t
          ),
        }))
      },

      updateCropBox: (trackType, cropBox) => {
        set(state => ({
          tracks: state.tracks.map(t => {
            if (t.type === trackType && t.segments[0]) {
              return {
                ...t,
                segments: [{ ...t.segments[0], cropBox }],
              }
            }
            return t
          }),
        }))
      },

      addMarker: (marker) => {
        set(state => ({
          markers: [...state.markers, marker],
        }))
      },

      deleteMarker: (markerId) => {
        set(state => ({
          markers: state.markers.filter(m => m.id !== markerId),
        }))
      },

      updateMarker: (markerId, patch) => {
        set(state => ({
          markers: state.markers.map(m =>
            m.id === markerId ? { ...m, ...patch } : m
          ),
        }))
      },

      pushUndo: () => {
        const state = get()
        const snapshot: Partial<TimelineState & { markers: Marker[] }> = {
          clip: state.clip,
          tracks: JSON.parse(JSON.stringify(state.tracks)),
          duration: state.duration,
          markers: JSON.parse(JSON.stringify(state.markers)),
        }
        set(state => ({
          undoStack: [...state.undoStack, snapshot],
          redoStack: [],
          canUndo: true,
          canRedo: false,
        }))
      },

      undo: () => {
        const state = get()
        if (state.undoStack.length === 0) return

        const prev = state.undoStack[state.undoStack.length - 1]
        const currentSnapshot: Partial<TimelineState & { markers: Marker[] }> = {
          clip: state.clip,
          tracks: JSON.parse(JSON.stringify(state.tracks)),
          duration: state.duration,
          markers: JSON.parse(JSON.stringify(state.markers)),
        }

        set({
          ...prev,
          undoStack: state.undoStack.slice(0, -1),
          redoStack: [...state.redoStack, currentSnapshot],
          canUndo: state.undoStack.length > 1,
          canRedo: true,
        })
      },

      redo: () => {
        const state = get()
        if (state.redoStack.length === 0) return

        const next = state.redoStack[state.redoStack.length - 1]
        const currentSnapshot: Partial<TimelineState & { markers: Marker[] }> = {
          clip: state.clip,
          tracks: JSON.parse(JSON.stringify(state.tracks)),
          duration: state.duration,
          markers: JSON.parse(JSON.stringify(state.markers)),
        }

        set({
          ...next,
          undoStack: [...state.undoStack, currentSnapshot],
          redoStack: state.redoStack.slice(0, -1),
          canUndo: true,
          canRedo: state.redoStack.length > 1,
        })
      },

      resetTimeline: () => {
        set(INITIAL_STATE)
      },

      get canUndo() {
        return this.undoStack.length > 0
      },

      get canRedo() {
        return this.redoStack.length > 0
      },
    }),
    {
      name: 'momiji-timeline-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        clip: state.clip,
        tracks: state.tracks,
        duration: state.duration,
        videoPath: state.videoPath,
        videoDimensions: state.videoDimensions,
        markers: state.markers,
      }),
    }
  )
)

// Helper to build subtitle segments from transcript
export function buildSubtitleSegments(
  transcript: { segments: { start: number; end: number; text: string; words: { word: string; start: number; end: number; probability: number }[] }[] },
  clipStart: number,
  clipEnd: number,
  wordsPerLine = 2,
): TrackSegment[] {
  const clipWords = transcript.segments
    .flatMap(s => s.words)
    .filter(w => w.start >= clipStart && w.end <= clipEnd)
    .map(w => ({ ...w, start: w.start - clipStart, end: w.end - clipStart }))

  const segments: TrackSegment[] = []
  for (let i = 0; i < clipWords.length; i += wordsPerLine) {
    const lineWords = clipWords.slice(i, i + wordsPerLine)
    if (!lineWords.length) continue
    segments.push({
      id: uid(),
      start: lineWords[0].start,
      end: lineWords[lineWords.length - 1].end,
      type: 'subtitle',
      locked: false,
      text: lineWords.map(w => w.word).join(' '),
      words: lineWords,
    })
    if (lineWords[lineWords.length - 1].end - lineWords[0].start < 0.8) {
      segments[segments.length - 1].end = lineWords[0].start + 0.8
    }
  }
  return segments
}
