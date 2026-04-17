import React, { useCallback } from 'react'

interface TimelineRulerProps {
  duration: number
  zoom: number
  onSeek: (time: number) => void
}

export function TimelineRuler({ duration, zoom, onSeek }: TimelineRulerProps) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const time = x / zoom
    if (time >= 0 && time <= duration) {
      onSeek(time)
    }
  }, [zoom, duration, onSeek])

  // Generate tick marks
  const ticks: { time: number; label: string; major: boolean }[] = []

  // Determine tick interval based on zoom level
  let interval: number
  if (zoom > 200) interval = 0.5 // 500ms at high zoom
  else if (zoom > 100) interval = 1 // 1s
  else if (zoom > 50) interval = 2 // 2s
  else if (zoom > 25) interval = 5 // 5s
  else interval = 10 // 10s at low zoom

  // Generate major and minor ticks
  for (let t = 0; t <= duration; t += interval / 4) {
    const isMajor = t % interval === 0
    const isMedium = t % (interval / 2) === 0
    if (isMajor || isMedium) {
      const minutes = Math.floor(t / 60)
      const seconds = (t % 60).toFixed(0)
      const label = isMajor ? `${minutes}:${seconds.padStart(2, '0')}` : ''
      ticks.push({ time: t, label, major: isMajor })
    }
  }

  return (
    <div
      className="h-8 relative border-b border-[var(--ctp-overlay)] cursor-pointer"
      onClick={handleClick}
      style={{ width: Math.max(duration * zoom, 1000) }}
    >
      {ticks.map((tick, i) => {
        const x = tick.time * zoom
        const height = tick.major ? 16 : 8
        const isMajor = tick.major

        return (
          <div
            key={i}
            className="absolute top-0 flex flex-col items-center"
            style={{ left: x }}
          >
            {/* Tick mark */}
            <div
              className={`bg-[var(--ctp-subtext)] ${isMajor ? 'w-[1px] h-4' : 'w-[1px] h-2'}`}
            />

            {/* Label for major ticks */}
            {tick.label && (
              <span className="text-[10px] text-[var(--ctp-subtext)] mt-1 select-none">
                {tick.label}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
