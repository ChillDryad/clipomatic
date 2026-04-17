import type { Clip, Transcript, TimelineData } from './types'

// ---------------------------------------------------------------------------
// Abort controllers for cancelling in-flight operations
// ---------------------------------------------------------------------------

const abortControllers = new Map<string, AbortController>()

export function getAbortController(key: string): AbortController {
  const existing = abortControllers.get(key)
  if (existing) return existing
  const controller = new AbortController()
  abortControllers.set(key, controller)
  return controller
}

export function cancelOperation(key: string): void {
  const controller = abortControllers.get(key)
  if (controller) {
    controller.abort()
    abortControllers.delete(key)
  }
}

export function clearAbortControllers(): void {
  abortControllers.clear()
}

// ---------------------------------------------------------------------------
// SSE reader
// ---------------------------------------------------------------------------

export interface ProgressEvent {
  progress: number
  label: string
}

export interface DoneEvent<T = unknown> {
  done: true
  result: T
}

export interface ErrorEvent {
  error: string
  traceback: string
}

export type SSEEvent<T = unknown> = ProgressEvent | DoneEvent<T> | ErrorEvent | { heartbeat: true }

export async function* readSSE<T = unknown>(response: Response, signal?: AbortSignal): AsyncGenerator<SSEEvent<T>> {
  if (!response.body) throw new Error('Response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  try {
    while (true) {
      if (signal?.aborted) {
        reader.releaseLock()
        throw new Error('Operation cancelled')
      }
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const chunks = buf.split('\n\n')
      buf = chunks.pop() ?? ''
      for (const chunk of chunks) {
        const line = chunk.replace(/^data: /, '').trim()
        if (!line) continue
        try {
          const event = JSON.parse(line) as SSEEvent<T>
          if (!('heartbeat' in event)) yield event
        } catch {
          // malformed line — skip
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      reader.releaseLock()
      throw new Error('Operation cancelled')
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export async function uploadFile(
  file: File,
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/ingest/upload', { method: 'POST', body: form, signal, credentials: 'include' })
  return consumeSSE<string>(res, onProgress, signal)
}

export async function downloadUrl(
  url: string,
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/ingest/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
    credentials: 'include',
  })
  return consumeSSE<string>(res, onProgress, signal)
}

export async function streamTwitchAudio(
  url: string,
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/ingest/twitch/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
    credentials: 'include',
  })
  return consumeSSE<string>(res, onProgress, signal)
}

export async function checkTwitchCache(url: string): Promise<{
  cached: boolean
  transcript?: Transcript
  audio_path?: string
}> {
  const res = await fetch(`/api/ingest/twitch/check?url=${encodeURIComponent(url)}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

export async function transcribe(
  params: {
    video_path?: string
    audio_path?: string
    model_size: string
    device: string
    language?: string
  },
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<Transcript> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
    credentials: 'include',
  })
  return consumeSSE<Transcript>(res, onProgress, signal)
}

export async function getCachedTranscript(path: string): Promise<Transcript | null> {
  const res = await fetch(`/api/transcribe/cached?path=${encodeURIComponent(path)}`, { credentials: 'include' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

export async function detectHighlights(
  transcript: Transcript,
  model: string,
  sourcePath: string | null,
  onProgress: (p: number, label: string) => void,
): Promise<Clip[]> {
  const res = await fetch('/api/highlights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, model, source_path: sourcePath }),
    credentials: 'include',
  })
  return consumeSSE<Clip[]>(res, onProgress)
}

export async function getCachedClips(sourcePath: string): Promise<Clip[] | null> {
  const res = await fetch(`/api/highlights/cached?path=${encodeURIComponent(sourcePath)}`, { credentials: 'include' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export function frameUrl(videoPath: string, t: number): string {
  return `/api/frame?video=${encodeURIComponent(videoPath)}&t=${t}`
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export async function fetchModels(): Promise<string[]> {
  const res = await fetch('/api/models', { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.models as string[]
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export async function downloadSegment(
  url: string,
  start: number,
  end: number,
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/render/segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, start, end }),
    credentials: 'include',
    signal,
  })
  return consumeSSE<string>(res, onProgress, signal)
}

export async function renderClip(
  params: {
    video_path: string
    clip: Clip & { start: number; end: number }
    crop_avatar: { x: number; y: number; w: number; h: number }
    crop_game: { x: number; y: number; w: number; h: number }
    segments: unknown[]
    font_name: string
    font_color: string
    highlight_color: string
    outline_color: string
    outline_width: number
    shadow_color: string
    shadow_depth: number
    shadow_opacity: number
    font_size: number
    subtitle_fade_in_ms: number
    subtitle_fade_out_ms: number
    caption_style: string
    words_per_line: number
    quality_preset: string
  },
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/render/clip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    credentials: 'include',
    signal,
  })
  return consumeSSE<string>(res, onProgress, signal)
}

// ---------------------------------------------------------------------------
// Clip metadata
// ---------------------------------------------------------------------------

export async function updateClipMetadata(
  clipKey: string,
  patch: Partial<Clip>,
): Promise<Clip> {
  const res = await fetch(`/api/clips/${encodeURIComponent(clipKey)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getClip(clipId: string): Promise<Clip> {
  const res = await fetch(`/api/clips/${encodeURIComponent(clipId)}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function regenerateClipMetadata(
  clipId: string,
  clip: Clip,
  transcript: { segments: { start: number; end: number; text: string; words: { word: string; start: number; end: number; probability: number }[] }[] },
): Promise<Clip> {
  const res = await fetch(`/api/clips/${encodeURIComponent(clipId)}/regenerate-metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ clip, transcript }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export interface PostJob {
  id: string
  clip_key: string
  video_path: string
  title: string
  description: string
  hashtags: string[]
  schedule_at: number
  posted_at: number | null
  status: 'pending' | 'scheduled' | 'posted' | 'failed' | 'cancelled'
  platform: 'youtube' | 'tiktok' | 'instagram'
  platform_account_id: string
  error_message: string | null
  metadata: Record<string, unknown>
  created_at: number
  updated_at: number
}

export async function schedulePost(params: {
  clip_key: string
  video_path: string
  title: string
  description: string
  hashtags: string[]
  platform: string
  platform_account_id: string
  schedule_at: number
  metadata?: Record<string, unknown>
}): Promise<{ job_id: string }> {
  const res = await fetch('/api/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getScheduleJobs(filters?: {
  status?: string
  platform?: string
}): Promise<PostJob[]> {
  const params = new URLSearchParams(filters ?? {})
  const res = await fetch(`/api/schedule?${params}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function updateJob(
  jobId: string,
  patch: Partial<PostJob>,
): Promise<PostJob> {
  const res = await fetch(`/api/schedule/${jobId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function cancelJob(jobId: string): Promise<void> {
  const res = await fetch(`/api/schedule/${jobId}`, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
}

export async function getJobStatus(jobId: string): Promise<PostJob> {
  const res = await fetch(`/api/schedule/${jobId}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// OAuth / Platform accounts
// ---------------------------------------------------------------------------

export interface PlatformAccount {
  id: string
  platform: string
  label: string
  account_id: string
  is_active: boolean
}

export async function getPlatformAccounts(
  platform: string,
): Promise<PlatformAccount[]> {
  const res = await fetch(`/api/oauth/${platform}/accounts`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function disconnectAccount(
  platform: string,
  accountId: string,
): Promise<void> {
  const res = await fetch(`/api/oauth/${platform}/accounts/${accountId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
}

export function platformOAuthAuthorizeUrl(platform: string): string {
  return `/api/oauth/${platform}/authorize`
}

// ---------------------------------------------------------------------------
// Segment transcription (re-transcribe clip window with better model)
// ---------------------------------------------------------------------------

export async function transcribeSegment(
  params: {
    video_path: string
    start: number
    end: number
    model_size: string
    device: string
    language?: string
  },
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<Transcript> {
  const res = await fetch('/api/transcribe/segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    credentials: 'include',
    signal,
  })
  return consumeSSE<Transcript>(res, onProgress, signal)
}

// ---------------------------------------------------------------------------
// Twitch VOD browser
// ---------------------------------------------------------------------------

export interface TwitchVod {
  id: string
  title: string
  thumbnail_url: string
  duration: number  // seconds
  view_count: number
  created_at: string  // ISO 8601
  url: string
}

export async function listTwitchVods(): Promise<{ vods: TwitchVod[] }> {
  const res = await fetch('/api/ingest/twitch/vods', { credentials: 'include' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export function twitchAuthorizeUrl(label: string): string {
  return `/api/oauth/twitch/authorize?label=${encodeURIComponent(label)}`
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function getConfig(): Promise<{
  llm_base_url: string
  llm_model: string
  whisper_model: string
  whisper_device: string
}> {
  const res = await fetch('/api/config', { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// Recent videos (HomePage)
// ---------------------------------------------------------------------------

export interface RecentVideo {
  sourcePath: string
  title: string
  clipCount: number
  createdAt: number
}

export async function getRecentVideos(limit = 10): Promise<RecentVideo[]> {
  const res = await fetch(`/api/videos/recent?limit=${limit}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return (data.videos ?? []) as RecentVideo[]
}

// ---------------------------------------------------------------------------
// Video detail
// ---------------------------------------------------------------------------

export async function getAllClips(sourcePath: string): Promise<Clip[]> {
  const clips = await getCachedClips(sourcePath)
  return clips ?? []
}

// ---------------------------------------------------------------------------
// Video dimensions
// ---------------------------------------------------------------------------

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac', '.opus'])

export async function getVideoDimensions(videoPath: string): Promise<{ w: number; h: number }> {
  const ext = videoPath.slice(videoPath.lastIndexOf('.')).toLowerCase()
  if (AUDIO_EXTS.has(ext)) {
    // Audio files have no video stream — fall back to standard 1080p
    return { w: 1920, h: 1080 }
  }
  const res = await fetch(`/api/video/dimensions?video=${encodeURIComponent(videoPath)}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return { w: data.width, h: data.height }
}

// ---------------------------------------------------------------------------
// Subtitle parsing
// ---------------------------------------------------------------------------

export interface SubtitleCue {
  text: string
  startTime: number
  duration: number
}

export async function parseSubtitleFile(file: File): Promise<SubtitleCue[]> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/subtitles/parse', { method: 'POST', body: form, credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.cues as SubtitleCue[]
}

// ---------------------------------------------------------------------------
// Timeline data loading
// ---------------------------------------------------------------------------

export async function loadTimelineData(
  clipKey: string,
  sourcePath: string,
): Promise<TimelineData> {
  const [clip, transcript] = await Promise.all([
    getClip(clipKey),
    getCachedTranscript(sourcePath),
  ])

  if (!transcript) {
    throw new Error('Transcript not found')
  }

  const dims = await getVideoDimensions(sourcePath)

  return {
    clip,
    transcript,
    videoPath: sourcePath,
    videoDimensions: dims,
  }
}

export async function loadTimelineDataByProject(
  projectId: string,
  clipId: string,
): Promise<TimelineData> {
  // Fetch clip from project-specific endpoint
  const res = await fetch(`/api/projects/${projectId}/clips/${clipId}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  const clip = await res.json()

  // Fetch project to get source path
  const projectRes = await fetch(`/api/projects/${projectId}`, { credentials: 'include' })
  if (!projectRes.ok) throw new Error(await projectRes.text())
  const project = await projectRes.json()

  const [transcript, dims] = await Promise.all([
    getCachedTranscript(project.source_path),
    getVideoDimensions(project.source_path),
  ])

  if (!transcript) {
    throw new Error('Transcript not found')
  }

  return {
    clip,
    transcript,
    videoPath: project.source_path,
    videoDimensions: dims,
  }
}

export async function downloadTimelinePreview(
  clip: { start: number; end: number },
  sourcePath: string,
  twitchUrl: string,
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const paddedStart = Math.max(0, clip.start - 10)
  const paddedEnd = clip.end + 30
  return downloadSegment(twitchUrl, paddedStart, paddedEnd, onProgress, signal)
}

// ---------------------------------------------------------------------------
// Error parsing utilities
// ---------------------------------------------------------------------------

/**
 * Parse backend error messages into user-friendly, actionable feedback.
 * Maps common error patterns to helpful suggestions.
 */
export function parseApiError(error: unknown): { message: string; suggestion?: string } {
  const raw = String(error)

  // Connection/network errors
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError')) {
    return {
      message: 'Connection lost to server',
      suggestion: 'Check your network connection and try again',
    }
  }

  // Ollama/LLM errors
  if (raw.includes('ollama') || raw.includes('LLM')) {
    if (raw.includes('connection refused') || raw.includes('ECONNREFUSED')) {
      return {
        message: 'Cannot connect to LLM service (Ollama)',
        suggestion: 'Ensure Ollama is running: docker compose up -d ollama',
      }
    }
    if (raw.includes('model not found') || raw.includes('model does not exist')) {
      return {
        message: 'LLM model not available',
        suggestion: 'Pull the model: docker exec -it momiji-ollama ollama pull llama3.1:8b',
      }
    }
  }

  // Whisper/GPU errors
  if (raw.includes('CUDA') || raw.includes('GPU') || raw.includes('out of memory')) {
    return {
      message: 'GPU memory exhausted',
      suggestion: 'Try a smaller Whisper model (e.g., base or small) or restart the container',
    }
  }

  if (raw.includes('whisper') || raw.includes('transcribe')) {
    if (raw.includes('failed') || raw.includes('error')) {
      return {
        message: 'Transcription failed',
        suggestion: 'Try CPU mode or a smaller model if GPU failed',
      }
    }
  }

  // yt-dlp / streaming errors
  if (raw.includes('yt-dlp') || raw.includes('ffmpeg')) {
    if (raw.includes('could not resolve') || raw.includes('failed')) {
      return {
        message: 'Stream download failed',
        suggestion: 'Check the URL is valid and the video is still available',
      }
    }
    if (raw.includes('Private') || raw.includes('unavailable')) {
      return {
        message: 'Video unavailable',
        suggestion: 'This video may be private, deleted, or region-locked',
      }
    }
  }

  // File errors - be specific to avoid false positives
  // Only match when it's clearly about a local file, not streaming
  if (raw.includes('ENOENT') ||
      raw.includes('No such file or directory') ||
      (raw.includes('File not found') && !raw.includes('yt-dlp') && !raw.includes('ffmpeg') && !raw.includes('stream'))) {
    return {
      message: 'File not found',
      suggestion: 'The video file may have been deleted or moved',
    }
  }

  // Permission errors
  if (raw.includes('EACCES') || raw.includes('Permission denied')) {
    return {
      message: 'Permission denied',
      suggestion: 'Check file permissions in the workspace directory',
    }
  }

  // Timeout errors
  if (raw.includes('timeout') || raw.includes('timed out')) {
    return {
      message: 'Operation timed out',
      suggestion: 'The operation took too long - try with a smaller file or model',
    }
  }

  // Default: return raw error
  return { message: raw }
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function consumeSSE<T>(
  response: Response,
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<T> {
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text)
  }
  for await (const event of readSSE<T>(response, signal)) {
    if ('progress' in event) {
      onProgress(event.progress, event.label)
    } else if ('done' in event) {
      return event.result as T
    } else if ('error' in event) {
      throw new Error(event.error)
    }
  }
  throw new Error('SSE stream ended without a done event')
}

// ---------------------------------------------------------------------------
// Markers API
// ---------------------------------------------------------------------------

export interface MarkerApi {
  id: string
  time: number
  duration?: number
  label: string
  color: string
  project_id?: string
  extra_data?: Record<string, unknown>
  created_at?: number
  updated_at?: number
}

export async function createMarker(marker: Omit<MarkerApi, 'id' | 'created_at' | 'updated_at'>): Promise<MarkerApi> {
  const res = await fetch('/api/markers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(marker),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function listMarkers(projectId?: string): Promise<MarkerApi[]> {
  const url = projectId ? `/api/markers?project_id=${encodeURIComponent(projectId)}` : '/api/markers'
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.markers ?? []
}

export async function updateMarker(markerId: string, marker: Partial<MarkerApi>): Promise<MarkerApi> {
  const res = await fetch(`/api/markers/${markerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(marker),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteMarker(markerId: string): Promise<void> {
  const res = await fetch(`/api/markers/${markerId}`, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
}

// ---------------------------------------------------------------------------
// Video Projects API
// ---------------------------------------------------------------------------

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
}

export interface ProjectClip {
  id: string
  project_id: string
  index: number
  title: string
  start_time: number
  end_time: number
  reason: string | null
  virality_score: number | null
  brand_alignment: string | null
  hashtags: string | null
  render_path: string | null
  created_at: number
}

export async function createProject(data: {
  source_path: string
  original_filename: string
}): Promise<VideoProject> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getProject(projectId: string): Promise<VideoProject> {
  const res = await fetch(`/api/projects/${projectId}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function listProjects(teamId?: string): Promise<VideoProject[]> {
  const url = teamId ? `/api/projects?team_id=${encodeURIComponent(teamId)}` : '/api/projects'
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.projects || data
}

export async function getProjectClips(projectId: string): Promise<ProjectClip[]> {
  const res = await fetch(`/api/projects/${projectId}/clips`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.clips || data
}

export async function addClipsToProject(
  projectId: string,
  clips: Array<{
    title: string
    start: number
    end: number
    reason: string
    virality_score: number
    brand_alignment: string[]
    hashtags: string[]
  }>,
): Promise<{ clips: ProjectClip[] }> {
  const res = await fetch(`/api/projects/${projectId}/clips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clips }),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// Media Library
// ---------------------------------------------------------------------------

export interface MediaAsset {
  id: string
  filename: string
  url: string
  width: number
  height: number
  type: 'image' | 'video'
  created_at: number
}

export async function uploadMedia(file: File): Promise<MediaAsset> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/media/upload', { method: 'POST', body: form, credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function listMedia(): Promise<MediaAsset[]> {
  const res = await fetch('/api/media/list', { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.items ?? []
}

export async function deleteMedia(mediaId: string): Promise<void> {
  const res = await fetch(`/api/media/${mediaId}`, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string
  email: string
  display_name: string | null
  is_verified: boolean
  created_at: number
}

export async function register(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ user: AuthUser }> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',  // Required for HttpOnly cookies
    body: JSON.stringify({ email, password, display_name: displayName }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Registration failed')
  }
  return res.json()
}

export async function login(
  email: string,
  password: string,
): Promise<{ user: AuthUser }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',  // Required for HttpOnly cookies
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Login failed')
  }
  return res.json()
}

export async function logout(): Promise<void> {
  // Call backend to clear HttpOnly cookie
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    // Ignore errors - cookie will be cleared on next login
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const res = await fetch('/api/auth/me', {
    credentials: 'include',  // Send cookie for authentication
  })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export function oauthAuthorizeUrl(provider: string): string {
  return `/api/auth/${provider}/authorize`
}

export async function updateProfile(data: {
  email?: string
  display_name?: string
}): Promise<AuthUser> {
  const res = await fetch('/api/user/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Failed to update profile')
  }
  return res.json()
}

export async function changePassword(data: {
  current_password: string
  new_password: string
}): Promise<void> {
  const res = await fetch('/api/user/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Failed to change password')
  }
}

export async function deleteAccount(): Promise<void> {
  const res = await fetch('/api/user/account', {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Failed to delete account')
  }
}

// ---------------------------------------------------------------------------
// Team Invites
// ---------------------------------------------------------------------------

export interface TeamInvite {
  id: string
  team_id: string
  team_name: string
  invitee_email: string
  invitee_id: string | null
  inviter_id: string
  role: string
  status: 'pending' | 'accepted' | 'declined' | 'expired'
  expires_at: number | null
  created_at: number
}

export async function sendTeamInvite(data: {
  team_id: string
  email: string
  role: string
}): Promise<TeamInvite> {
  const res = await fetch(`/api/teams/${data.team_id}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: data.email, role: data.role }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Failed to send invite')
  }
  return res.json()
}

export async function listTeamInvites(): Promise<TeamInvite[]> {
  const res = await fetch('/api/user/invites')
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.invites || []
}

export async function acceptTeamInvite(inviteId: string): Promise<void> {
  const res = await fetch(`/api/teams/invites/${inviteId}/accept`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function declineTeamInvite(inviteId: string): Promise<void> {
  const res = await fetch(`/api/teams/invites/${inviteId}/decline`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function cancelTeamInvite(inviteId: string): Promise<void> {
  const res = await fetch(`/api/teams/invites/${inviteId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(await res.text())
}

// ---------------------------------------------------------------------------
// Audio / Waveform
// ---------------------------------------------------------------------------

export async function uploadAudio(file: File): Promise<{ id: string; duration: number; url: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/audio/upload', { method: 'POST', body: form, credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getWaveform(audioPath: string): Promise<{ peaks: number[]; rms: number[]; duration: number; num_points: number }> {
  const res = await fetch(`/api/audio/waveform?audio_path=${encodeURIComponent(audioPath)}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// Timeline Render
// ---------------------------------------------------------------------------

export async function renderTimeline(
  params: {
    timeline: unknown
    markers: MarkerApi[]
    quality_preset: string
  },
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/render/timeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    credentials: 'include',
    signal,
  })
  return consumeSSE<string>(res, onProgress, signal)
}
