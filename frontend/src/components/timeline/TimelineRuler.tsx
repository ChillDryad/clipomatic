import type { TimelineState } from '../../types'

interface Props {
  duration: number
  pxPerSecond: number
  currentTime: number
  onSeek: (time: number) => void
}

export function TimelineRuler({ duration, pxPerSecond, currentTime, onSeek }: Props) {
  const width = duration * pxPerSecond

  // Generate tick marks
  const ticks: { time: number; major: boolean }[] = []
  for (let t = 0; t <= duration; t += 1) {
    ticks.push({ time: t, major: t % 5 === 0 })
  }

  return (
    <div
      className="relative h-6 bg-[var(--ctp-surface)] border-b border-[var(--ctp-overlay)] cursor-pointer select-none"
      style={{ width }}
      role="slider"
      aria-label="Timeline ruler. Click to seek."
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={0}
      tabIndex={0}
      onClick={e => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - rect.left
        const time = Math.max(0, Math.min(duration, x / pxPerSecond))
        onSeek(time)
      }}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, currentTime - 1)) }
        if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(duration, currentTime + 1)) }
      }}
    >
      {ticks.map(({ time, major }) => (
        <div
          key={time}
          className="absolute top-0 w-px bg-[var(--ctp-overlay)]"
          style={{ left: time * pxPerSecond }}
        >
          {major && (
            <>
              <div className="absolute -top-4 -translate-x-1/2 text-[10px] text-[var(--ctp-subtext)] font-mono">
                {formatTime(time)}
              </div>
              <div className="absolute top-0 w-px h-2 bg-[var(--ctp-subtext)]" />
            </>
          )}
        </div>
      ))}
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}