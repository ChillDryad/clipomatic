import { useCallback } from 'react'

interface Props {
  pxPerSecond: number
  onChange: (zoom: number) => void
  min?: number
  max?: number
}

export function ZoomSlider({
  pxPerSecond,
  onChange,
  min = 10,
  max = 200,
}: Props) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseInt(e.target.value))
  }, [onChange])

  const handleZoomOut = useCallback(() => {
    onChange(Math.max(min, pxPerSecond - 10))
  }, [pxPerSecond, onChange, min])

  const handleZoomIn = useCallback(() => {
    onChange(Math.min(max, pxPerSecond + 10))
  }, [pxPerSecond, onChange, max])

  const percentage = ((pxPerSecond - min) / (max - min)) * 100

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Timeline zoom control">
      <button
        onClick={handleZoomOut}
        aria-label="Zoom out"
        className="btn-ghost p-1.5 rounded-lg min-w-[36px] min-h-[36px] flex items-center justify-center"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
        </svg>
      </button>

      <div className="relative w-32 h-8 flex items-center">
        <input
          type="range"
          min={min}
          max={max}
          value={pxPerSecond}
          onChange={handleChange}
          aria-label="Zoom level"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={pxPerSecond}
          className="w-full h-1.5 rounded-full cursor-pointer appearance-none bg-[var(--ctp-overlay)] accent-[var(--ctp-mauve)]"
        />
        {/* Custom thumb indicator */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[var(--ctp-mauve)] border-2 border-[var(--ctp-base)] shadow-md pointer-events-none"
          style={{ left: `calc(${percentage}% - 8px)` }}
          aria-hidden="true"
        />
      </div>

      <button
        onClick={handleZoomIn}
        aria-label="Zoom in"
        className="btn-ghost p-1.5 rounded-lg min-w-[36px] min-h-[36px] flex items-center justify-center"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      <span className="text-xs text-[var(--ctp-subtext)] font-mono w-12 text-right">
        {pxPerSecond}px/s
      </span>
    </div>
  )
}
