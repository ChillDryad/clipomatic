import { useEffect, useState, useRef, useCallback } from 'react'
import { downloadSegment } from '../../api'
import { CropCanvas } from '../CropCanvas'
import type { CropBox } from '../../types'

interface Props {
  videoPath: string
  currentTime: number
  videoDimensions: { w: number; h: number }
  avatarCrop: CropBox
  gameplayCrop: CropBox
  clipStart: number
  clipEnd: number
  twitchUrl: string | null
  sourceUrl?: string | null  // Original YouTube/video URL for re-download
  isPlaying: boolean
  onCropChange: (avatar: CropBox, gameplay: CropBox) => void
  onSeek: (time: number) => void
  // Optional: parent-managed download state (for TimelineEditorPage)
  downloadState?: 'idle' | 'checking' | 'downloading' | 'done' | 'error'
  downloadProgress?: number
  downloadLabel?: string
  onDownloadComplete?: (path: string) => void
}

// Output dimensions are 1080x1920 (9:16 aspect ratio)
const OUTPUT_WIDTH = 1080
const OUTPUT_HEIGHT = 1920
const OUTPUT_ASPECT = OUTPUT_WIDTH / OUTPUT_HEIGHT // 0.5625

// Display canvas size (scaled down for UI)
const MAX_DISPLAY_WIDTH = 360

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac', '.opus'])
function isAudioFile(path: string): boolean {
  return AUDIO_EXTS.has(path.slice(path.lastIndexOf('.')).toLowerCase())
}

export function PreviewPlayer({
  videoPath,
  currentTime,
  videoDimensions,
  avatarCrop,
  gameplayCrop,
  clipStart,
  clipEnd,
  twitchUrl,
  sourceUrl,
  isPlaying,
  onCropChange,
  onSeek,
  downloadState: parentDownloadState,
  downloadProgress: parentDownloadProgress,
  downloadLabel: parentDownloadLabel,
  onDownloadComplete,
}: Props) {
  // Use parent download state if provided, otherwise use local state
  const [localDownloadState, setLocalDownloadState] = useState<'idle' | 'checking' | 'downloading' | 'done' | 'error'>('idle')
  const [localDownloadProgress, setLocalDownloadProgress] = useState(0)
  const [localDownloadLabel, setLocalDownloadLabel] = useState('')
  const [activePath, setActivePath] = useState<string | null>(null)
  const [mounted, setMounted] = useState(0) // increment to force remount
  const [userProvidedUrl, setUserProvidedUrl] = useState<string>('')

  const downloadState = parentDownloadState ?? localDownloadState
  const downloadProgress = parentDownloadProgress ?? localDownloadProgress
  const downloadLabel = parentDownloadLabel ?? localDownloadLabel

  // Check if video file exists on mount and when videoPath changes
  useEffect(() => {
    if (isAudioFile(videoPath)) {
      // Audio files don't need the check - they show the download prompt directly
      return
    }

    if (!parentDownloadState) {
      setLocalDownloadState('checking')
    }
    fetch(`/workspace/${videoPath.split('/').pop()}?t=0`, { method: 'HEAD' })
      .then(res => {
        if (res.ok) {
          if (!parentDownloadState) setLocalDownloadState('done')
        } else {
          // File not found - prompt user
          if (!parentDownloadState) setLocalDownloadState('idle')
        }
      })
      .catch(() => {
        if (!parentDownloadState) setLocalDownloadState('idle')
      })
  }, [videoPath, parentDownloadState])

  // Video element ref (plain DOM, no Konva)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Effective URL for the video element
  const effectiveUrl = activePath
    ? `/workspace/${activePath.split('/').pop()}`
    : videoPath.startsWith('/workspace')
    ? videoPath
    : `/workspace/${videoPath.split('/').pop()}`

  // Force a remount when download completes so video src switches cleanly
  useEffect(() => {
    if (downloadState === 'done') {
      setMounted(m => m + 1)
    }
  }, [downloadState, activePath])

  // Seek the video element whenever currentTime changes
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const absTime = activePath ? Math.max(0, clipStart - 10 + currentTime) : currentTime
    if (Math.abs(video.currentTime - absTime) > 0.5) {
      video.currentTime = absTime
    }
  }, [currentTime, activePath, clipStart])

  // When the video src changes (remount), seek to correct position
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const absTime = activePath ? Math.max(0, clipStart - 10 + currentTime) : currentTime
    const handleLoadedMetadata = () => {
      video.currentTime = absTime
    }
    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata)
  }, [mounted, activePath, clipStart, currentTime])

  // Play/pause the video when isPlaying changes
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying) {
      video.play().catch(err => console.warn('Video play failed:', err))
    } else {
      video.pause()
    }
  }, [isPlaying])

  // Click on video to seek
  const handleVideoClick = useCallback(() => {
    onSeek(currentTime)
  }, [currentTime, onSeek])

  // Calculate display size maintaining 9:16 aspect ratio
  const displayScale = MAX_DISPLAY_WIDTH / OUTPUT_WIDTH
  const canvasWidth = Math.round(OUTPUT_WIDTH * displayScale) // 360
  const canvasHeight = Math.round(OUTPUT_HEIGHT * displayScale) // 640

  // Frame URL for the static preview (used for CropCanvas-style overlay)
  const frameUrl = `/api/frame?video=${encodeURIComponent(effectiveUrl)}&t=${activePath ? Math.max(0, clipStart - 10 + currentTime) : currentTime}`

  // ---- File missing states (audio-only or video file not found) ----
  const isMissingFile = isAudioFile(videoPath) || (!activePath && downloadState === 'idle')

  if (isMissingFile && downloadState === 'idle') {
    const isAudio = isAudioFile(videoPath)
    const displayUrl = sourceUrl || twitchUrl || ''
    return (
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[var(--ctp-subtext)]">Preview — {formatTime(currentTime)}</span>
          <div className="text-xs text-[var(--ctp-subtext)] font-mono">Output: {OUTPUT_WIDTH}×{OUTPUT_HEIGHT}</div>
        </div>
        <div
          className="relative mx-auto bg-black rounded overflow-hidden flex items-center justify-center"
          style={{ width: canvasWidth, height: canvasHeight }}
        >
          <div className="text-center text-[var(--ctp-subtext)]">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
            </svg>
            {isAudio ? (
              <>
                <p className="text-sm mb-4">Audio-only source — download preview segment to edit</p>
                <button
                  onClick={async () => {
                    const urlToUse = twitchUrl || sourceUrl
                    if (!urlToUse) return
                    if (parentDownloadState !== undefined) {
                      // Parent manages state - just call onDownloadComplete
                      onDownloadComplete?.(urlToUse)
                    } else {
                      setLocalDownloadState('downloading')
                      setLocalDownloadProgress(0)
                      setLocalDownloadLabel('Downloading preview segment…')
                      try {
                        const segPath = await downloadSegment(urlToUse, Math.max(0, clipStart - 10), clipEnd + 30, (p, l) => {
                          setLocalDownloadProgress(p)
                          setLocalDownloadLabel(l)
                        })
                        setActivePath(segPath)
                        setLocalDownloadState('done')
                      } catch (err) {
                        setLocalDownloadState('error')
                        setLocalDownloadLabel(String(err))
                      }
                    }
                  }}
                  className="btn-primary"
                  disabled={!twitchUrl && !sourceUrl}
                >
                  Download Preview
                </button>
              </>
            ) : (
              <>
                <p className="text-sm mb-4">Video file not found — download clip segment to edit</p>
                {displayUrl ? (
                  <button
                    onClick={async () => {
                      if (parentDownloadState !== undefined) {
                        onDownloadComplete?.(displayUrl)
                      } else {
                        setLocalDownloadState('downloading')
                        setLocalDownloadProgress(0)
                        setLocalDownloadLabel('Downloading clip segment…')
                        try {
                          const segPath = await downloadSegment(displayUrl, Math.max(0, clipStart - 10), clipEnd + 30, (p, l) => {
                            setLocalDownloadProgress(p)
                            setLocalDownloadLabel(l)
                          })
                          setActivePath(segPath)
                          setLocalDownloadState('done')
                        } catch (err) {
                          setLocalDownloadState('error')
                          setLocalDownloadLabel(String(err))
                        }
                      }
                    }}
                    className="btn-primary"
                  >
                    Download from {new URL(displayUrl).hostname.replace('www.', '')}
                  </button>
                ) : (
                  <>
                    <p className="text-xs mb-3 max-w-xs">Enter the original video URL to download the clip:</p>
                    <input
                      type="url"
                      value={userProvidedUrl}
                      onChange={(e) => setUserProvidedUrl(e.target.value)}
                      placeholder="https://youtube.com/watch?v=..."
                      className="glass-input text-sm mb-3 w-full max-w-xs mx-auto block"
                    />
                    <button
                      onClick={async () => {
                        if (!userProvidedUrl.trim()) return
                        if (parentDownloadState !== undefined) {
                          onDownloadComplete?.(userProvidedUrl.trim())
                        } else {
                          setLocalDownloadState('downloading')
                          setLocalDownloadProgress(0)
                          setLocalDownloadLabel('Downloading clip segment…')
                          try {
                            const segPath = await downloadSegment(userProvidedUrl.trim(), Math.max(0, clipStart - 10), clipEnd + 30, (p, l) => {
                              setLocalDownloadProgress(p)
                              setLocalDownloadLabel(l)
                            })
                            setActivePath(segPath)
                            setLocalDownloadState('done')
                          } catch (err) {
                            setLocalDownloadState('error')
                            setLocalDownloadLabel(String(err))
                          }
                        }
                      }}
                      className="btn-primary"
                      disabled={!userProvidedUrl.trim()}
                    >
                      Download Clip
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (downloadState === 'downloading') {
    return (
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[var(--ctp-subtext)]">Preview — {formatTime(currentTime)}</span>
          <div className="text-xs text-[var(--ctp-subtext)] font-mono">Output: {OUTPUT_WIDTH}×{OUTPUT_HEIGHT}</div>
        </div>
        <div
          className="relative mx-auto bg-black rounded overflow-hidden flex items-center justify-center"
          style={{ width: canvasWidth, height: canvasHeight }}
        >
          <div className="text-center text-[var(--ctp-subtext)] w-full px-6">
            <svg className="w-10 h-10 mx-auto mb-3 opacity-60 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <p className="text-sm mb-3">{downloadLabel}</p>
            <div className="w-full bg-[var(--ctp-overlay)] rounded-full h-2 mb-1">
              <div className="bg-[var(--ctp-mauve)] h-2 rounded-full transition-all duration-300" style={{ width: `${downloadProgress * 100}%` }} />
            </div>
            <p className="text-xs font-mono">{Math.round(downloadProgress * 100)}%</p>
          </div>
        </div>
      </div>
    )
  }

  if (downloadState === 'error') {
    return (
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[var(--ctp-subtext)]">Preview — {formatTime(currentTime)}</span>
          <div className="text-xs text-[var(--ctp-subtext)] font-mono">Output: {OUTPUT_WIDTH}×{OUTPUT_HEIGHT}</div>
        </div>
        <div
          className="relative mx-auto bg-black rounded overflow-hidden flex items-center justify-center"
          style={{ width: canvasWidth, height: canvasHeight }}
        >
          <div className="text-center text-[var(--ctp-red)]">
            <p className="text-sm mb-3">Download failed</p>
            <p className="text-xs text-[var(--ctp-subtext)] mb-3 max-w-xs">{downloadLabel}</p>
            <button onClick={() => { if (!parentDownloadState) setLocalDownloadState('idle') }} className="btn-secondary text-sm">Retry</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[var(--ctp-subtext)]">Preview — {formatTime(currentTime)}</span>
        <div className="text-xs text-[var(--ctp-subtext)] font-mono">{videoDimensions.w}×{videoDimensions.h}</div>
      </div>

      {downloadState === 'done' && (
        <div className="text-xs text-[var(--ctp-green)] mb-2 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Preview loaded
        </div>
      )}

      {/* Video + crop overlay container - 9:16 aspect ratio */}
      <div
        className="relative mx-auto bg-black rounded overflow-hidden cursor-pointer"
        style={{ width: canvasWidth, height: canvasHeight, aspectRatio: '9/16' }}
        onClick={handleVideoClick}
      >
        {/* CropCanvas — always visible as crop overlay, non-interactive when playing */}
        <div className="absolute inset-0" style={{ pointerEvents: isPlaying ? 'none' : 'auto' }}>
          <CropCanvas
            frameUrl={frameUrl}
            videoDimensions={videoDimensions}
            initialGameplay={gameplayCrop}
            initialAvatar={avatarCrop}
            onChange={onCropChange}
          />
        </div>

        {/* Video — visible when playing, drives time sync */}
        <video
          key={mounted}
          ref={videoRef}
          src={effectiveUrl}
          className="absolute inset-0 w-full h-full object-contain"
          muted
          autoPlay={isPlaying}
          preload="auto"
          onClick={e => e.stopPropagation()}
          onTimeUpdate={() => {
            const video = videoRef.current
            if (video) {
              const absTime = activePath ? Math.max(0, clipStart - 10 + video.currentTime) : video.currentTime
              const relTime = activePath ? absTime - (clipStart - 10) : absTime
              onSeek(relTime)
            }
          }}
          onEnded={() => onSeek(0)}
        />
      </div>

      {/* Crop coords debug display */}
      <div className="flex gap-4 text-[10px] text-[var(--ctp-subtext)] font-mono mt-1">
        <span className="text-[#89b4fa]">Gameplay {gameplayCrop.w}×{gameplayCrop.h} @ ({gameplayCrop.x},{gameplayCrop.y})</span>
        <span className="text-[#cba6f7]">Avatar {avatarCrop.w}×{avatarCrop.h} @ ({avatarCrop.x},{avatarCrop.y})</span>
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${m}:${parseFloat(s) < 10 ? '0' : ''}${s}`
}
