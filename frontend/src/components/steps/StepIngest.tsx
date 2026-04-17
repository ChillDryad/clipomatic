import { useState } from 'react'
import { uploadFile, downloadUrl, streamTwitchAudio, checkTwitchCache, listTwitchVods, twitchAuthorizeUrl, createProject, parseApiError, getAbortController, cancelOperation, type TwitchVod } from '../../api'
import { ProgressBar } from '../ui/ProgressBar'
import { usePipeline } from '../../context/PipelineContext'

export function StepIngest() {
  const { setSource, setProjectId } = usePipeline()
  const [tab, setTab] = useState<'upload' | 'url' | 'twitch' | 'my-vods'>('upload')
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null)
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [twitchInput, setTwitchInput] = useState('')
  const [twitchCache, setTwitchCache] = useState<{
    cached: boolean
    transcript?: import('../../types').Transcript
    audio_path?: string
  } | null>(null)
  const [vods, setVods] = useState<TwitchVod[]>([])
  const [vodLoading, setVodLoading] = useState(false)
  const [vodError, setVodError] = useState<{ message: string; suggestion?: string } | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)

  const prog = (value: number, label: string) => setProgress({ value, label })

  const handleCancel = () => {
    setIsCancelling(true)
    if (tab === 'upload') {
      cancelOperation('upload')
    } else if (tab === 'url') {
      cancelOperation('download')
    } else if (tab === 'twitch') {
      cancelOperation('twitch-stream')
    }
  }

  // Helper to create project and redirect
  const handleSourceSet = async (videoPath: string | null, audioPath: string | null, twitchUrl: string | null, transcript: import('../../types').Transcript | null, videoUrl: string | null = null) => {
    // First set the source in pipeline context - this navigates to transcribe step
    setSource({ videoPath, audioPath, twitchUrl, videoUrl: videoUrl ?? null }, transcript)

    // Then create a VideoProject in the background (don't redirect yet)
    try {
      const filename = videoPath?.split('/').pop()?.replace(/\.[^.]+$/, '') || audioPath?.split('/').pop() || 'Unknown'
      const project = await createProject({
        source_path: videoPath || audioPath || '',
        original_filename: filename || 'Unknown',
      })
      // Store project ID in context for downstream steps
      setProjectId(project.id)
      // Note: We stay on the pipeline page so user can run transcription/highlights
      // Project page redirect happens after clips are detected
    } catch (err) {
      console.error('Failed to create project:', err)
      // Continue without project creation if it fails
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setProgress({ value: 0, label: 'Starting upload…' })
    setIsCancelling(false)
    try {
      const controller = getAbortController('upload')
      const videoPath = await uploadFile(file, prog, controller.signal)
      setProgress(null)
      await handleSourceSet(videoPath, null, null, null, null)
    } catch (err) {
      setProgress(null)
      if (String(err).includes('cancelled')) {
        setError({ message: 'Upload cancelled' })
      } else {
        setError(parseApiError(err))
      }
    } finally {
      setIsCancelling(false)
    }
  }

  const handleUrl = async () => {
    if (!urlInput.trim()) return
    setError(null)
    setProgress({ value: 0, label: 'Starting download…' })
    setIsCancelling(false)
    try {
      const controller = getAbortController('download')
      const videoPath = await downloadUrl(urlInput.trim(), prog, controller.signal)
      setProgress(null)
      await handleSourceSet(videoPath, null, null, null, urlInput.trim())
    } catch (err) {
      setProgress(null)
      if (String(err).includes('cancelled')) {
        setError({ message: 'Download cancelled' })
      } else {
        setError(parseApiError(err))
      }
    } finally {
      setIsCancelling(false)
    }
  }

  const handleTwitchCheck = async (url: string) => {
    setTwitchCache(null)
    if (!url.trim()) return
    try {
      const result = await checkTwitchCache(url.trim())
      setTwitchCache(result)
    } catch {
      setTwitchCache(null)
    }
  }

  const handleLoadVods = async () => {
    setVodError(null)
    setVodLoading(true)
    try {
      const { vods } = await listTwitchVods()
      setVods(vods)
    } catch (err) {
      setVodError(parseApiError(err))
    } finally {
      setVodLoading(false)
    }
  }

  const handleSelectVod = async (vod: TwitchVod) => {
    const vodUrl = `https://www.twitch.tv/videos/${vod.id}`
    setTwitchInput(vodUrl)
    await handleTwitchCheck(vodUrl)
  }

  const handleConnectTwitch = () => {
    const label = window.prompt('Enter a name for this Twitch account (e.g. "My Channel"):')
    if (!label) return
    window.open(twitchAuthorizeUrl(label), '_blank')
  }

  const handleLoadCached = async () => {
    if (!twitchCache?.cached || !twitchCache.transcript) return
    const audioPath = twitchCache.audio_path ?? null
    await handleSourceSet(null, audioPath, twitchInput.trim(), twitchCache.transcript, null)
  }

  const handleTwitchStream = async () => {
    if (!twitchInput.trim()) return
    setError(null)
    setProgress({ value: 0, label: 'Fetching stream info…' })
    setIsCancelling(false)
    try {
      const controller = getAbortController('twitch-stream')
      const audioPath = await streamTwitchAudio(twitchInput.trim(), prog, controller.signal)
      setProgress(null)
      await handleSourceSet(null, audioPath, twitchInput.trim(), null, null)
    } catch (err) {
      setProgress(null)
      if (String(err).includes('cancelled')) {
        setError({ message: 'Stream cancelled' })
      } else {
        setError(parseApiError(err))
      }
    } finally {
      setIsCancelling(false)
    }
  }

  const tabs = [
    { id: 'upload' as const, label: 'Upload File' },
    { id: 'url' as const, label: 'Video URL' },
    { id: 'twitch' as const, label: 'Twitch VOD' },
    { id: 'my-vods' as const, label: 'My VODs' },
  ]

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-2 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setError(null); setProgress(null) }}
            className={`px-4 py-2 text-sm font-medium transition-all ${
              tab === t.id
                ? 'glass-tab-active'
                : 'glass-tab text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Upload */}
      {tab === 'upload' && (
        <div className="flex flex-col items-center py-6">
          <label className="glass-dropzone w-48 h-48 flex flex-col items-center justify-center cursor-pointer">
            <span className="text-3xl mb-2">📁</span>
            <span className="text-sm text-[var(--ctp-subtext)]">Drop MP4/MKV here</span>
            <span className="text-xs text-[var(--ctp-subtext)] opacity-70 mt-1">or click to browse</span>
            <input
              type="file"
              accept=".mp4,.mkv"
              onChange={handleUpload}
              disabled={!!progress}
              className="hidden"
            />
          </label>
        </div>
      )}

      {/* URL */}
      {tab === 'url' && (
        <div className="space-y-3">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUrl()}
            placeholder="https://www.youtube.com/watch?v=… or Twitch/Kick VOD URL"
            disabled={!!progress}
            className="glass-input input-field"
          />
          <button
            onClick={handleUrl}
            disabled={!!progress || !urlInput.trim()}
            className="btn-primary"
          >
            Download
          </button>
        </div>
      )}

      {/* Twitch */}
      {tab === 'twitch' && (
        <div className="space-y-3">
          <p className="text-xs text-[var(--ctp-subtext)]">
            Streams only the audio — no video stored. Clips are downloaded on demand.
          </p>
          <input
            type="url"
            value={twitchInput}
            onChange={(e) => {
              setTwitchInput(e.target.value)
              handleTwitchCheck(e.target.value)
            }}
            placeholder="https://www.twitch.tv/videos/2744090155"
            disabled={!!progress}
            className="glass-input input-field"
          />

          {twitchCache?.cached && (
            <div className="glass-card p-3 space-y-2">
              <p className="text-sm text-[var(--ctp-blue)]">
                Transcript already exists for this VOD. Load it to skip re-streaming.
              </p>
              <div className="flex gap-2">
                <button onClick={handleLoadCached} className="btn-primary text-sm py-1">
                  Load cached transcript
                </button>
                <button
                  onClick={handleTwitchStream}
                  disabled={!!progress}
                  className="btn-secondary text-sm py-1"
                >
                  Re-stream &amp; re-transcribe
                </button>
              </div>
            </div>
          )}

          {(!twitchCache || !twitchCache.cached) && (
            <button
              onClick={handleTwitchStream}
              disabled={!!progress || !twitchInput.trim()}
              className="btn-primary"
            >
              Stream Audio
            </button>
          )}
        </div>
      )}

      {/* My VODs */}
      {tab === 'my-vods' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--ctp-subtext)]">
              Browse your Twitch VOD library. Requires Twitch OAuth.
            </p>
            <button
              onClick={handleConnectTwitch}
              className="text-xs px-3 py-1 rounded bg-purple-800 text-purple-200 hover:bg-purple-700"
            >
              Connect Twitch
            </button>
          </div>

          {!vodLoading && vods.length === 0 && !vodError && (
            <button onClick={handleLoadVods} className="btn-primary">
              Load My VODs
            </button>
          )}

          {vodLoading && <p className="text-sm text-[var(--ctp-subtext)]">Loading VODs…</p>}

          {vodError && (
            <div className="glass-card p-3 border-l-4 border-[var(--ctp-red)]">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-[var(--ctp-red)] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-[var(--ctp-red)] mb-1">{vodError.message}</p>
                  {vodError.suggestion && (
                    <p className="text-xs text-[var(--ctp-subtext)] mb-2">{vodError.suggestion}</p>
                  )}
                  <button onClick={handleLoadVods} className="text-xs text-[var(--ctp-blue)] hover:text-[var(--ctp-text)] flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Retry
                  </button>
                </div>
              </div>
            </div>
          )}

          {vods.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {vods.map(vod => (
                <button
                  key={vod.id}
                  onClick={() => handleSelectVod(vod)}
                  className="glass-card p-2 text-left hover:bg-[var(--ctp-surface)] transition-colors"
                >
                  {/* Thumbnail */}
                  <div className="relative w-full rounded overflow-hidden mb-2" style={{ aspectRatio: '16/9' }}>
                    <img
                      src={vod.thumbnail_url.replace('{width}', '320').replace('{height}', '180')}
                      alt={vod.title}
                      className="w-full h-full object-cover"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                    {/* Duration badge */}
                    <span className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
                      {formatDuration(vod.duration)}
                    </span>
                  </div>
                  {/* Title */}
                  <p className="text-xs text-[var(--ctp-text)] line-clamp-2 leading-tight">{vod.title}</p>
                  {/* Meta */}
                  <p className="text-xs text-[var(--ctp-subtext)] mt-1">
                    {formatViews(vod.view_count)} views · {formatDate(vod.created_at)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {progress && (
        <div className="mt-4 space-y-2">
          <ProgressBar progress={progress.value} label={progress.label} />
          <div className="flex justify-end">
            <button
              onClick={handleCancel}
              disabled={isCancelling}
              className="text-xs text-[var(--ctp-red)] hover:text-[var(--ctp-red)]/80 disabled:opacity-50 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              {isCancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 glass-card p-3 border-l-4 border-[var(--ctp-red)]">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-[var(--ctp-red)] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--ctp-red)] mb-1">{error.message}</p>
              {error.suggestion && (
                <p className="text-xs text-[var(--ctp-subtext)] mb-2">{error.suggestion}</p>
              )}
              {tab === 'upload' && (
                <label className="text-xs text-[var(--ctp-blue)] hover:text-[var(--ctp-text)] inline-flex items-center gap-1 cursor-pointer">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Retry upload
                  <input type="file" accept=".mp4,.mkv" onChange={handleUpload} disabled={!!progress} className="hidden" />
                </label>
              )}
              {tab === 'url' && (
                <button onClick={handleUrl} className="text-xs text-[var(--ctp-blue)] hover:text-[var(--ctp-text)] flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Retry download
                </button>
              )}
              {tab === 'twitch' && (
                <button onClick={handleTwitchStream} className="text-xs text-[var(--ctp-blue)] hover:text-[var(--ctp-text)] flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Retry stream
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
