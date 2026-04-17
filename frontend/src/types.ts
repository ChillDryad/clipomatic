export interface Word {
  word: string
  start: number
  end: number
  probability: number
}

export interface Segment {
  start: number
  end: number
  text: string
  words: Word[]
}

export interface Transcript {
  language: string
  language_probability: number
  duration: number
  segments: Segment[]
}

export interface Clip {
  id: string
  title: string
  description?: string
  start: number
  end: number
  reason: string
  virality_score: number
  brand_alignment: string[]
  hashtags: string[]
  crop_avatar?: CropBox
  crop_game?: CropBox
  subtitle_segments?: string
  status?: 'pending' | 'processing' | 'complete' | 'failed'
  render_path?: string | null
  created_at?: number
  index?: number
}

export interface VideoProject {
  id: string
  owner_id: string
  team_id: string | null
  source_path: string
  original_filename: string
  duration: number | null
  status: 'pending' | 'processing' | 'complete' | 'failed'
  created_at: number
  updated_at: number
  clip_count?: number
  team_name?: string
}

export interface Team {
  id: string
  name: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  member_count?: number
}

export interface User {
  id: string
  email: string
  display_name: string | null
  avatar_url?: string
  is_verified?: boolean
  created_at?: number
}

export interface CropBox {
  x: number
  y: number
  w: number
  h: number
}

export interface Source {
  videoPath: string | null
  audioPath: string | null
  twitchUrl: string | null
  videoUrl: string | null  // Original YouTube/video URL for re-download
}

export interface Config {
  whisperModel: string
  whisperDevice: string
  llmModel: string
  llmBaseUrl: string
}

export type SSEEvent =
  | { heartbeat: true }
  | { progress: number; label: string }
  | { done: true; result: unknown }
  | { error: string; traceback: string }

// ---------------------------------------------------------------------------
// Timeline Editor
// ---------------------------------------------------------------------------

export interface TimelineState {
  clip: Clip
  tracks: Track[]
  duration: number
  videoPath: string
  videoDimensions: { w: number; h: number }
}

export interface Track {
  id: string
  type: TrackType
  label: string
  segments: TrackSegment[]
  visible: boolean
  locked: boolean
  volume: number      // for audio tracks (0.0 - 1.0)
  opacity: number     // for overlay tracks (0.0 - 1.0)
  collapsed: boolean  // UI state for collapsed tracks
}

export type TrackType = 'avatar' | 'gameplay' | 'subtitle' | 'overlay' | 'audio' | 'text' | 'marker'

export interface SubtitleStyleOverrides {
  fontSize?: number
  fontFamily?: string
  color?: string
  backgroundColor?: string
  textAlign?: 'left' | 'center' | 'right'
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
}

export interface TrackSegment {
  id: string
  start: number
  end: number
  type: 'crop' | 'subtitle' | 'overlay' | 'audio' | 'text' | 'marker'
  locked: boolean

  // Crop segments (avatar, gameplay)
  cropBox?: CropBox

  // Subtitle segments
  text?: string
  words?: Word[]
  style?: SubtitleStyleOverrides

  // Overlay segments
  overlayUrl?: string
  overlayType?: 'image' | 'video'
  position?: { x: number; y: number }
  scale?: number
  rotation?: number

  // Audio segments
  audioUrl?: string
  volume?: number
  fade?: { in: number; out: number }

  // Text segments
  fontStyle?: {
    family: string
    size: number
    weight: 'normal' | 'bold'
    style: 'normal' | 'italic'
    color: string
    backgroundColor?: string
    textAlign: 'left' | 'center' | 'right'
  }

  // Marker segments
  marker?: {
    label: string
    color: string
  }
}

export interface EditorNavigationState {
  modifiedClip?: Clip
  modifiedTranscript?: Transcript
}

export interface Marker {
  id: string
  time: number
  duration?: number
  label: string
  color: string
}

export interface Keyframe {
  time: number
  property: string
  value: number | string
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
}

export interface TimelineData {
  clip: Clip
  transcript: Transcript
  videoPath: string
  videoDimensions: { w: number; h: number }
}
