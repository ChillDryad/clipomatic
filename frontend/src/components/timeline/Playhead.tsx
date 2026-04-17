import { useEffect, useRef, useCallback } from 'react'
import type React from 'react'

interface Props {
  currentTime: number
  duration: number
  trackAreaWidth: number
  onSeek: (time: number) => void
  containerRef: React.RefObject<HTMLElement | null>
}

export function Playhead({ currentTime, duration, trackAreaWidth, onSeek, containerRef }: Props) {
  const isDragging = useRef(false)

  const seekFromX = useCallback((clientX: number) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    // x is content-relative: clientX relative to container viewport left, plus scroll offset
    const x = clientX - rect.left + container.scrollLeft
    const time = Math.max(0, Math.min(duration, (x / trackAreaWidth) * duration))
    onSeek(time)
  }, [duration, trackAreaWidth, onSeek, containerRef])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      seekFromX(e.clientX)
    }

    const handleMouseUp = () => {
      isDragging.current = false
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [seekFromX])

  // Content-relative left position
  const left = (currentTime / Math.max(duration, 1)) * trackAreaWidth

  return (
    <div
      className="absolute top-0 bottom-0 w-1 bg-[var(--ctp-pink)] z-20 cursor-ew-resize pointer-events-auto"
      style={{ left }}
      onMouseDown={e => {
        isDragging.current = true
        e.preventDefault()
      }}
    >
      {/* Playhead handle — larger triangle for visibility */}
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[8px] border-b-[var(--ctp-pink)]" />
      {/* Time tooltip */}
      <div
        className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] bg-[var(--ctp-pink)] text-[var(--ctp-base)] px-1.5 py-0.5 rounded font-mono whitespace-nowrap shadow-md"
        style={{ left: '50%' }}
      >
        {formatTime(currentTime)}
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${m}:${parseFloat(s) < 10 ? '0' : ''}${s}`
}