import React from 'react'

interface TimelinePlayheadProps {
  currentTime: number
  zoom: number
  duration: number
  showSnapIndicator?: boolean
}

export function TimelinePlayhead({ currentTime, zoom, duration, showSnapIndicator = false }: TimelinePlayheadProps) {
  const x = currentTime * zoom + 60 // TIMELINE_PADDING_LEFT

  return (
    <>
      {/* Playhead line */}
      <div
        className="absolute top-0 bottom-0 w-[2px] bg-[var(--ctp-mauve)] z-30 pointer-events-none"
        style={{ left: x }}
      >
        {/* Playhead handle at top */}
        <div className="absolute -top-1 -left-[5px] w-[12px] h-[12px] bg-[var(--ctp-mauve)] rounded-sm" />

        {/* Playhead triangle at bottom */}
        <div
          className="absolute -bottom-1 -left-[5px] w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-[var(--ctp-mauve)]"
        />
      </div>

      {/* Snap indicator line */}
      {showSnapIndicator && (
        <div
          className="absolute top-0 bottom-0 w-[1px] bg-[var(--ctp-green)] z-20 pointer-events-none opacity-50"
          style={{ left: x }}
        />
      )}
    </>
  )
}
