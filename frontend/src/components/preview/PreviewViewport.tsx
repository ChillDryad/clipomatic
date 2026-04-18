import React, { useRef, useCallback, useState, useEffect } from 'react'
import type { CropBox } from '../../types'

interface PreviewViewportProps {
  videoPath: string
  currentTime: number
  videoDimensions: { w: number; h: number }
  avatarCrop: CropBox
  gameplayCrop: CropBox
  clipStart: number
  clipEnd: number
  isPlaying: boolean
  onCropChange: (avatar: CropBox, gameplay: CropBox) => void
  onSeek: (time: number) => void
  downloadState?: 'idle' | 'downloading' | 'done'
  downloadProgress?: number
  downloadLabel?: string
}

// Extract filename from path and create workspace URL
function getWorkspaceUrl(videoPath: string): string {
  const filename = videoPath.split('/').pop()
  return `/workspace/${filename}`
}

export function PreviewViewport({
  videoPath,
  currentTime,
  videoDimensions,
  avatarCrop,
  gameplayCrop,
  clipStart,
  clipEnd,
  isPlaying,
  onCropChange,
  onSeek,
  downloadState = 'done',
  downloadProgress = 0,
  downloadLabel = '',
}: PreviewViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [isTransforming, setIsTransforming] = useState<'avatar' | 'gameplay' | null>(null)

  // Convert videoPath to workspace URL for video element
  const videoUrl = getWorkspaceUrl(videoPath)

  // 9:16 output format - avatar top 50%, gameplay bottom 50%
  const OUTPUT_ASPECT = 9 / 16

  // Calculate scaled display size
  const scaleToDisplay = useCallback(() => {
    if (!containerRef.current) return

    const containerW = containerRef.current.clientWidth
    const containerH = containerRef.current.clientHeight

    // Fit 9:16 canvas into container
    let displayW = containerW
    let displayH = containerW / OUTPUT_ASPECT

    if (displayH > containerH) {
      displayH = containerH
      displayW = containerH * OUTPUT_ASPECT
    }

    setContainerSize({ w: displayW, h: displayH })
  }, [])

  useEffect(() => {
    scaleToDisplay()
    window.addEventListener('resize', scaleToDisplay)
    return () => window.removeEventListener('resize', scaleToDisplay)
  }, [scaleToDisplay])

  // Sync video time with playhead (adjust for downloaded segment offset)
  useEffect(() => {
    if (videoRef.current) {
      // Adjust time to account for the 5-second pre-buffer
      const adjustedTime = Math.max(0, currentTime - clipStart)
      videoRef.current.currentTime = adjustedTime
    }
  }, [currentTime, clipStart])

  // Handle play/pause
  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.play().catch(() => {})
      } else {
        videoRef.current.pause()
      }
    }
  }, [isPlaying])

  // Calculate display-scale factors
  const scaleX = containerSize.w / 1080 // Output width is 1080
  const scaleY = containerSize.h / 1920 // Output height is 1920

  // Convert crop box to display coordinates
  const avatarDisplay = {
    x: avatarCrop.x * scaleX,
    y: avatarCrop.y * scaleY * 0.5, // Top half
    w: avatarCrop.w * scaleX,
    h: avatarCrop.h * scaleY * 0.5,
  }

  const gameplayDisplay = {
    x: gameplayCrop.x * scaleX,
    y: gameplayCrop.y * scaleY * 0.5 + containerSize.h * 0.5, // Bottom half
    w: gameplayCrop.w * scaleX,
    h: gameplayCrop.h * scaleY * 0.5,
  }

  // Handle click to seek
  const handleClick = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const ratio = x / rect.width
    const time = clipStart + ratio * (clipEnd - clipStart)
    onSeek(Math.max(clipStart, Math.min(clipEnd, time)))
  }, [clipStart, clipEnd, onSeek])

  // Avatar crop drag handling
  const handleAvatarDragStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsTransforming('avatar')

    const startX = e.clientX
    const startY = e.clientY
    const startCrop = { ...avatarCrop }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = (moveEvent.clientX - startX) / scaleX
      const dy = (moveEvent.clientY - startY) / (scaleY * 0.5)

      const newCrop = {
        ...startCrop,
        x: Math.max(0, Math.min(videoDimensions.w - startCrop.w, startCrop.x + dx)),
        y: Math.max(0, Math.min(videoDimensions.h * 0.5 - startCrop.h, startCrop.y + dy)),
      }

      onCropChange(newCrop, gameplayCrop)
    }

    const handleMouseUp = () => {
      setIsTransforming(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [avatarCrop, gameplayCrop, scaleX, scaleY, videoDimensions, onCropChange])

  // Gameplay crop drag handling
  const handleGameplayDragStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsTransforming('gameplay')

    const startX = e.clientX
    const startY = e.clientY
    const startCrop = { ...gameplayCrop }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = (moveEvent.clientX - startX) / scaleX
      const dy = (moveEvent.clientY - startY) / (scaleY * 0.5)

      const newCrop = {
        ...startCrop,
        x: Math.max(0, Math.min(videoDimensions.w - startCrop.w, startCrop.x + dx)),
        y: Math.max(videoDimensions.h * 0.5, Math.min(videoDimensions.h - startCrop.h, startCrop.y + dy)),
      }

      onCropChange(avatarCrop, newCrop)
    }

    const handleMouseUp = () => {
      setIsTransforming(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [gameplayCrop, avatarCrop, scaleX, scaleY, videoDimensions, onCropChange])

  return (
    <div className="relative bg-[var(--ctp-base)] rounded-lg overflow-hidden flex items-center justify-center">
      {/* Container for 9:16 preview */}
      <div
        ref={containerRef}
        className="relative bg-[var(--ctp-surface)]"
        style={{
          width: containerSize.w || '100%',
          height: containerSize.h || '100%',
          maxWidth: '100%',
          maxHeight: '100%',
        }}
        onClick={handleClick}
      >
        {/* Video element - visible, used for actual playback */}
        <video
          ref={videoRef}
          src={videoUrl}
          className="absolute inset-0 w-full h-full object-contain"
          muted
          playsInline
        />

        {/* Crop box overlays */}
        <div className="absolute inset-0">
          {/* Avatar crop overlay (top half) */}
          <div
            className="absolute border-2 border-[var(--ctp-blue)]/50"
            style={{
              left: avatarDisplay.x,
              top: avatarDisplay.y,
              width: avatarDisplay.w,
              height: avatarDisplay.h,
            }}
          >
            <div
              className="absolute -top-6 left-0 text-xs text-[var(--ctp-blue)] font-medium cursor-move"
              onMouseDown={handleAvatarDragStart}
            >
              Avatar
            </div>
          </div>

          {/* Gameplay crop overlay (bottom half) */}
          <div
            className="absolute border-2 border-[var(--ctp-green)]/50"
            style={{
              left: gameplayDisplay.x,
              top: gameplayDisplay.y,
              width: gameplayDisplay.w,
              height: gameplayDisplay.h,
            }}
          >
            <div
              className="absolute -top-6 left-0 text-xs text-[var(--ctp-green)] font-medium cursor-move"
              onMouseDown={handleGameplayDragStart}
            >
              Gameplay
            </div>
          </div>
        </div>

        {/* Download progress overlay */}
        {downloadState === 'downloading' && (
          <div className="absolute inset-0 bg-[var(--ctp-base)]/80 flex items-center justify-center">
            <div className="text-center">
              <div className="text-sm text-[var(--ctp-text)] mb-2">{downloadLabel}</div>
              <div className="w-48 bg-[var(--ctp-surface)] rounded-full h-2">
                <div
                  className="bg-[var(--ctp-mauve)] h-2 rounded-full transition-all"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Playhead indicator */}
        <div className="absolute bottom-2 right-2 text-xs text-[var(--ctp-subtext)] font-mono">
          {currentTime.toFixed(2)}s
        </div>
      </div>
    </div>
  )
}
