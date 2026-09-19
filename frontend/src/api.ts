import type { Clip, Transcript, TimelineData } from './types'

// ---------------------------------------------------------------------------
// Abort controllers for cancelling in-flight operations
// ---------------------------------------------------------------------------

const abortControllers = new Map<string, AbortController>()

/**
 * Gets or creates an AbortController for a given operation key.
 * Use this to manage cancellable async operations like API calls.
 *
 * @param key - Unique identifier for the operation (e.g., 'transcribe', 'upload')
 * @returns The AbortController instance for this operation
 *
 * @example
 * ```typescript
 * const controller = getAbortController('transcribe')
 * fetch('/api/transcribe', { signal: controller.signal })
 * // Later: cancelOperation('transcribe') to abort
 * ```
 */
export function getAbortController(key: string): AbortController {
  const existing = abortControllers.get(key)
  if (existing) return existing
  const controller = new AbortController()
  abortControllers.set(key, controller)
  return controller
}

/**
 * Aborts and removes an operation's AbortController.
 * Call this when the user cancels an operation or navigates away.
 *
 * @param key - The operation key to cancel
 *
 * @example
 * ```typescript
 * // In cleanup effect:
 * return () => cancelOperation('transcribe')
 * ```
 */
export function cancelOperation(key: string): void {
  const controller = abortControllers.get(key)
  if (controller) {
    controller.abort()
    abortControllers.delete(key)
  }
}

/**
 * Clears all abort controllers. Call this on app unmount or major navigation.
 */
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

/**
 * Reads and parses Server-Sent Events (SSE) from a response stream.
 * Yields progress updates, completion events, and errors as they arrive.
 *
 * @param response - The fetch Response containing the SSE stream
 * @param signal - Optional AbortSignal for cancellation
 * @returns AsyncGenerator yielding SSE events
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/transcribe', { ... })
 * for await (const event of readSSE(response, signal)) {
 *   if ('progress' in event) {
 *     setProgress(event.progress, event.label)
 *   } else if ('done' in event) {
 *     setResult(event.result)
 *   }
 * }
 * ```
 */
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

export interface IngestResult {
  videoPath: string
  audioPath?: string
  contentHash?: string
  displayName?: string
  redirect?: boolean
  projectId?: string
  url?: string
  videoTitle?: string
  duration?: number
}

/**
 * Uploads a video file to the server for processing.
 * Requires a user-provided name for the video.
 *
 * @param file - The video file to upload (MP4, MKV, MOV, AVI, or WebM)
 * @param onProgress - Callback for progress updates (0-100, label)
 * @param signal - Optional AbortSignal for cancellation
 * @returns Object with videoPath and optional contentHash
 *
 * @example
 * ```typescript
 * const result = await uploadFile(file, onProgress)
 * console.log(`Uploaded to: ${result.videoPath}`)
 * ```
 */
export async function uploadFile(
  file: File,
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<IngestResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/ingest/upload', { method: 'POST', body: form, signal, credentials: 'include' })
  return consumeSSE<IngestResult>(res, onProgress, signal)
}

/**
 * Downloads a video from a URL (YouTube, Twitch, Kick, etc.).
 * Auto-names the video using metadata from the source.
 * May return a redirect if the video already exists.
 *
 * @param url - The video URL to download
 * @param onProgress - Callback for progress updates (0-100, label)
 * @param signal - Optional AbortSignal for cancellation
 * @returns Object with videoPath, videoTitle, duration, and optional redirect info
 *
 * @example
 * ```typescript
 * const result = await downloadUrl('https://youtube.com/watch?v=...', onProgress)
 * if (result.redirect) {
 *   window.location.href = result.url // Redirect to existing project
 * }
 * ```
 */
export async function downloadUrl(
  url: string,
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<IngestResult> {
  const res = await fetch('/api/ingest/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
    credentials: 'include',
  })
  return consumeSSE<IngestResult>(res, onProgress, signal)
}

/**
 * Streams audio from a Twitch VOD URL without storing video.
 * Auto-names the VOD using metadata. May return a redirect if already exists.
 *
 * @param url - The Twitch VOD URL
 * @param onProgress - Callback for progress updates (0-100, label)
 * @param signal - Optional AbortSignal for cancellation
 * @returns Object with audioPath, videoTitle, duration, and optional redirect info
 */
export async function streamTwitchAudio(
  url: string,
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<IngestResult> {
  const res = await fetch('/api/ingest/twitch/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
    credentials: 'include',
  })
  return consumeSSE<IngestResult>(res, onProgress, signal)
}

/**
 * Checks if a Twitch URL is already cached in the workspace.
 *
 * @param url - The Twitch VOD URL to check
 * @returns Object indicating cache status and optional cached data
 */
export async function checkTwitchCache(url: string): Promise<{
  cached: boolean
  transcript?: Transcript
  audio_path?: string
}> {
  const res = await fetch(`/api/ingest/twitch/check?url=${encodeURIComponent(url)}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

/**
 * Check the ingestion state for a given source path.
 * Returns whether video/audio file exists, and if transcript/clips are cached.
 */
export async function checkIngestState(sourcePath: string): Promise<{
  file_exists: boolean
  transcript_cached: boolean
  clips_cached: boolean
}> {
  const res = await fetch(`/api/ingest/check/${encodeURIComponent(sourcePath)}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

/**
 * Get the complete pipeline state for a project.
 * Includes cached transcript and clips if available.
 */
export async function getProjectPipelineState(projectId: string): Promise<{
  project: {
    id: string
    source_path: string
    original_filename: string
    duration: number | null
    status: string
  }
  transcript: Transcript | null
  transcript_cached: boolean
  clips: Clip[] | null
  clips_cached: boolean
}> {
  const res = await fetch(`/api/projects/${projectId}/pipeline-state`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/**
 * Transcribes audio/video using Whisper ASR.
 *
 * @param params - Transcription parameters
 * @param params.video_path - Path to video file (optional if audio_path provided)
 * @param params.audio_path - Path to audio file (optional if video_path provided)
 * @param params.model_size - Whisper model size (tiny, base, small, medium, large-v3)
 * @param params.device - Compute device (auto, cuda, cpu)
 * @param params.language - Optional language code (e.g., 'en', 'ja')
 * @param onProgress - Callback for progress updates (0-100, label)
 * @param signal - Optional AbortSignal for cancellation
 * @returns The transcript with segments and word-level timestamps
 *
 * @example
 * ```typescript
 * const transcript = await transcribe({
 *   video_path: '/workspace/video.mp4',
 *   model_size: 'large-v3',
 *   device: 'auto',
 * }, (progress) => setProgress(progress))
 * ```
 */
export async function transcribe(
  params: {
    video_path?: string
    audio_path?: string
    model_size: string
    device: string
    language?: string
    project_id?: string
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

/**
 * Retrieves a cached transcript by file path.
 *
 * @param path - The workspace path of the source file
 * @returns The cached transcript or null if not found
 */
export async function getCachedTranscript(path: string): Promise<Transcript | null> {
  const res = await fetch(`/api/transcribe/cached?path=${encodeURIComponent(path)}`, { credentials: 'include' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

/**
 * Saves a cached transcript to the database for a project.
 * Call this when user accepts cached transcript data.
 */
export async function saveCachedTranscript(projectId: string, transcript: Transcript): Promise<{ success: boolean }> {
  const res = await fetch('/api/transcribe/save-cached', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, transcript }),
    credentials: 'include',
  })
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
  projectId?: string | null,
): Promise<Clip[]> {
  const res = await fetch('/api/highlights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, model, source_path: sourcePath, project_id: projectId }),
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

/**
 * Saves cached clips to the database for a project.
 * Call this when user accepts cached clips data.
 */
export async function saveCachedClips(projectId: string, clips: Clip[]): Promise<{ success: boolean }> {
  const res = await fetch('/api/highlights/save-cached', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, clips }),
    credentials: 'include',
  })
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
// Thumbnails
// ---------------------------------------------------------------------------

export async function uploadProjectThumbnail(
  projectId: string,
  file: File,
): Promise<{ thumbnail_path: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`/api/projects/${projectId}/thumbnail`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteProjectThumbnail(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/thumbnail`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function autoGenerateProjectThumbnail(
  projectId: string,
): Promise<{ thumbnail_path: string }> {
  const res = await fetch(`/api/projects/${projectId}/thumbnail/auto-generate`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getThumbnailStatus(
  projectId: string,
): Promise<{ has_thumbnail: boolean; thumbnail_path: string | null }> {
  const res = await fetch(`/api/projects/${projectId}/thumbnail/status`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export function thumbnailUrl(projectId: string): string {
  return `/api/projects/${projectId}/thumbnail`
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
  videoPath: string,
  start: number,
  end: number,
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/render/segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: videoPath, start, end }),
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
    layout_mode: string
    animation_speed?: 'fast' | 'normal' | 'slow'
    style_preset?: string | null
    thumbnail_path?: string | null
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

export async function renderPreview(
  params: {
    video_path: string
    clip: { start: number; end: number }
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
    layout_mode: string
    animation_speed?: 'fast' | 'normal' | 'slow'
    thumbnail_path?: string | null
  },
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/render/preview', {
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

/**
 * Updates a clip's metadata by project ID and clip index.
 */
export async function updateClip(
  projectId: string,
  clipIndex: number,
  patch: Partial<Clip>,
): Promise<{ success: boolean }> {
  const res = await fetch(`/api/projects/${projectId}/clips/${clipIndex}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

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

export async function generatePostDescription(
  clipId: string,
  clip: Clip,
  transcript: { segments: { start: number; end: number; text: string; words: { word: string; start: number; end: number; probability: number }[] }[] },
): Promise<{ post_body: string }> {
  const res = await fetch(`/api/clips/${encodeURIComponent(clipId)}/generate-post-description`, {
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
// First-run setup and provider configuration
// ---------------------------------------------------------------------------

export type LlmProvider = 'ollama' | 'openai'

export interface ProviderSettings {
  provider: LlmProvider
  base_url: string
  api_key?: string
  llm_model: string
  highlight_model?: string
  vision_model?: string
}

export interface SetupPayload extends ProviderSettings {
  email: string
  password: string
  display_name?: string
}

export interface SetupStatus {
  setup_complete: boolean
}

export interface Config extends Omit<ProviderSettings, 'api_key'> {
  has_api_key: boolean
  // Legacy fields remain optional while existing settings UI migrates.
  llm_base_url?: string
  whisper_model?: string
  whisper_device?: string
  nvenc_available?: boolean
}

async function setupRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(error.detail ?? res.statusText)
  }
  return res.json()
}

export async function getSetupStatus(): Promise<SetupStatus> {
  return setupRequest('/api/setup/status')
}

export async function getSetupOllamaModels(): Promise<{ models: string[] }> {
  return setupRequest('/api/setup/ollama-models')
}

export async function setup(payload: SetupPayload): Promise<{ user: AuthUser; setup_complete: true }> {
  return setupRequest('/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function testProvider(settings: ProviderSettings): Promise<{ models: string[] }> {
  return setupRequest('/api/setup/test-provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}

export async function getConfig(): Promise<Config> {
  return setupRequest('/api/config')
}

export async function saveConfig(config: Partial<ProviderSettings> & {
  llm_base_url?: string
  whisper_model?: string
  whisper_device?: string
}): Promise<{ success: boolean }> {
  return setupRequest('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
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
    } else if ('redirect' in event) {
      return event as unknown as T
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
  original_source: string
  original_filename: string
  duration: number | null
  status: 'pending' | 'processing' | 'complete' | 'failed'
  created_at: number
  updated_at: number
  clip_count?: number
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
  original_source?: string | null
  original_filename: string
  duration?: number
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

export interface ListProjectsResponse {
  projects: VideoProject[]
  total: number
  limit: number
  offset: number
  has_more: boolean
}

export async function listProjects(
  teamId?: string,
  limit = 20,
  offset = 0,
): Promise<ListProjectsResponse> {
  const params = new URLSearchParams()
  if (teamId) params.set('team_id', teamId)
  params.set('limit', limit.toString())
  params.set('offset', offset.toString())

  const res = await fetch(`/api/projects?${params}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getProjectClips(projectId: string): Promise<ProjectClip[]> {
  const res = await fetch(`/api/projects/${projectId}/clips`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.clips || data
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
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

// ---------------------------------------------------------------------------
// Pipeline Queue API
// ---------------------------------------------------------------------------

export interface PipelineJobApi {
  id: string
  project_id: string
  owner_id: string
  steps: string[]
  current_step: number
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  config: Record<string, unknown>
  step_progress: number
  step_label: string | null
  error_message: string | null
  failed_step: string | null
  retry_count: number
  priority: number
  queued_at: number
  started_at: number | null
  completed_at: number | null
  auto_advance: boolean
  created_at: number
}

export interface PipelineEventApi {
  id: string
  event_type: string
  step: string | null
  progress: number | null
  label: string | null
  detail: string | null
  created_at: number
}

export async function enqueuePipelineJob(params: {
  project_id: string
  steps?: string[]
  config?: Record<string, unknown>
}): Promise<{ job_id: string; status: string; steps: string[] }> {
  const res = await fetch('/api/pipeline/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getPipelineJobs(filters?: {
  status?: string
  limit?: number
  offset?: number
}): Promise<{ jobs: PipelineJobApi[]; total: number; has_more: boolean }> {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.limit) params.set('limit', filters.limit.toString())
  if (filters?.offset) params.set('offset', filters.offset.toString())
  const res = await fetch(`/api/pipeline/jobs?${params}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getPipelineJob(jobId: string): Promise<PipelineJobApi> {
  const res = await fetch(`/api/pipeline/jobs/${jobId}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getPipelineJobEvents(
  jobId: string,
  since: number,
): Promise<{ events: PipelineEventApi[] }> {
  const res = await fetch(`/api/pipeline/jobs/${jobId}/events?since=${since}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export function pipelineJobStreamUrl(jobId: string): string {
  return `/api/pipeline/jobs/${jobId}/stream`
}

export async function cancelPipelineJob(jobId: string): Promise<{ status: string }> {
  const res = await fetch(`/api/pipeline/jobs/${jobId}/cancel`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function retryPipelineJob(
  jobId: string,
  config?: Record<string, unknown>,
): Promise<{ job_id: string; status: string }> {
  const res = await fetch(`/api/pipeline/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config ? { config } : {}),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function pausePipelineJob(jobId: string): Promise<{ status: string; auto_advance: boolean }> {
  const res = await fetch(`/api/pipeline/jobs/${jobId}/pause`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function resumePipelineJob(jobId: string): Promise<{ job_id: string; status: string }> {
  const res = await fetch(`/api/pipeline/jobs/${jobId}/resume`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getPipelineQueueStatus(): Promise<{
  queued: number
  running: number
  per_user: Record<string, Record<string, number>>
}> {
  const res = await fetch('/api/pipeline/queue', { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export interface ApiKeyInfo {
  id: string
  label: string
  key_prefix: string
  scopes: string[] | null
  is_active: boolean
  last_used_at: number | null
  expires_at: number | null
  created_at: number
}

export interface CreateApiKeyResult {
  key: string
  id: string
  label: string
  key_prefix: string
  scopes: string[] | null
  expires_at: number | null
  created_at: number
}

export async function listApiKeys(): Promise<ApiKeyInfo[]> {
  const res = await fetch('/api/api-keys', { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function createApiKey(label: string, scopes?: string[], expiresAt?: number): Promise<CreateApiKeyResult> {
  const res = await fetch('/api/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ label, scopes, expires_at: expiresAt }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function revokeApiKey(keyId: string): Promise<{ status: string }> {
  const res = await fetch(`/api/api-keys/${keyId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export interface AgentPairStartResult {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval?: number
}

export interface AgentPairApprovalResult {
  status: string
  client_name?: string
  expires_at?: number
}

export interface AgentPairExchangeResult extends CreateApiKeyResult {
  token_type?: string
}

export interface AgentInfo {
  name: string
  version?: string
  api_base_url?: string
  capabilities?: string[]
  pairing_enabled?: boolean
}

export async function startAgentPairing(clientName: string): Promise<AgentPairStartResult> {
  const res = await fetch('/api/api-keys/pair/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ client_name: clientName }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function approveAgentPairing(userCode: string): Promise<AgentPairApprovalResult> {
  const res = await fetch('/api/api-keys/pair/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ user_code: userCode }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function exchangeAgentPairing(deviceCode: string): Promise<AgentPairExchangeResult> {
  const res = await fetch('/api/api-keys/pair/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ device_code: deviceCode }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function rotateApiKey(keyId: string): Promise<CreateApiKeyResult> {
  const res = await fetch(`/api/api-keys/${keyId}/rotate`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getAgentInfo(): Promise<AgentInfo> {
  const res = await fetch('/api/agent/info', { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function listApiKeyScopes(): Promise<{ scopes: string[] }> {
  const res = await fetch('/api/api-keys/scopes', { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// Clip Studio - Source Quality Batch Export
// ---------------------------------------------------------------------------

export interface ClipStudioExport {
  id: string
  clip_index: number
  title: string
  start_time: number
  end_time: number
  duration: number
  virality_score: number | null
  brand_alignment: string[]
  reason: string | null
  export_path: string
  export_format: string
  export_quality: string
  file_size: number | null
  width: number | null
  height: number | null
  video_codec: string | null
  audio_codec: string | null
  bitrate: string | null
  metadata: Record<string, unknown>
  created_at: number
}

export interface ClipStudioQueueItem {
  id: string
  project_id: string
  status: string
  priority: number
  config: Record<string, unknown>
  progress: number
  current_step: string | null
  error_message: string | null
  queued_at: number
  started_at: number | null
  completed_at: number | null
  exports: ClipStudioExport[]
}

export async function enqueueClipStudio(
  projectIds: string[],
  config?: {
    export_quality?: string
    export_format?: string
    include_metadata?: boolean
    generate_edl?: boolean
    output_dir?: string
    priority?: number
  },
): Promise<{ queued: number; status: string }> {
  const res = await fetch('/api/pipeline/clip-studio/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ project_ids: projectIds, config }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function listClipStudioQueue(filters?: {
  status?: string
  limit?: number
  offset?: number
}): Promise<{ items: ClipStudioQueueItem[]; total: number; has_more: boolean }> {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.limit) params.set('limit', String(filters.limit))
  if (filters?.offset) params.set('offset', String(filters.offset))
  const res = await fetch(`/api/pipeline/clip-studio/queue?${params}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getClipStudioQueueItem(queueId: string): Promise<ClipStudioQueueItem> {
  const res = await fetch(`/api/pipeline/clip-studio/queue/${queueId}`, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function cancelClipStudioQueue(queueId: string): Promise<{ status: string }> {
  const res = await fetch(`/api/pipeline/clip-studio/queue/${queueId}/cancel`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// Clip Studio - Process video through full pipeline then export at source quality
// ---------------------------------------------------------------------------

export async function processVideoForClips(
  projectId: string,
  config?: {
    export_quality?: string
    export_format?: string
    include_metadata?: boolean
    generate_edl?: boolean
  },
): Promise<{ queued: number; status: string }> {
  return enqueueClipStudio([projectId], config)
}

export async function batchProcessVideosForClips(
  projectIds: string[],
  config?: {
    export_quality?: string
    export_format?: string
    include_metadata?: boolean
    generate_edl?: boolean
  },
): Promise<{ queued: number; status: string }> {
  return enqueueClipStudio(projectIds, config)
}
