interface SnapPoint {
  time: number
  type: 'playhead' | 'segment-start' | 'segment-end' | 'marker'
  label?: string
}

interface Props {
  snapPoints: SnapPoint[]
  pxPerSecond: number
  visible: boolean
}

/**
 * Visual indicator showing where snapping occurs during drag operations.
 * Displays a magnetic line and optional label at snap points.
 */
export function SnapIndicator({ snapPoints, pxPerSecond, visible }: Props) {
  if (!visible || snapPoints.length === 0) return null

  return (
    <>
      {snapPoints.map((point, index) => {
        const left = point.time * pxPerSecond

        return (
          <div
            key={`${point.type}-${point.time}-${index}`}
            className="absolute top-0 bottom-0 pointer-events-none z-30"
            style={{ left }}
          >
            {/* Snap line */}
            <div
              className="absolute top-0 bottom-0 w-px bg-[var(--ctp-mauve)] shadow-[0_0_8px_var(--ctp-mauve-30)]"
              aria-hidden="true"
            />

            {/* Magnet icon at top */}
            <div className="absolute -top-5 -translate-x-1/2 flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-[var(--ctp-mauve)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              {point.label && (
                <span className="text-[10px] text-[var(--ctp-mauve)] font-mono whitespace-nowrap">
                  {point.label}
                </span>
              )}
            </div>

            {/* Time indicator at bottom */}
            <div className="absolute -bottom-6 -translate-x-1/2 px-1.5 py-0.5 rounded bg-[var(--ctp-mauve)] text-[var(--ctp-base)] text-[10px] font-mono whitespace-nowrap">
              {formatTime(point.time)}
            </div>
          </div>
        )
      })}
    </>
  )
}

/**
 * Compact snap indicator for inline display during drag operations.
 * Shows a small badge indicating the snap target.
 */
export function SnapBadge({
  snapped,
  snapType,
  snapTime,
}: {
  snapped: boolean
  snapType?: string
  snapTime?: number
}) {
  if (!snapped) return null

  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--ctp-mauve-20)] border border-[var(--ctp-mauve-30)]">
      <svg className="w-3 h-3 text-[var(--ctp-mauve)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      <span className="text-[10px] text-[var(--ctp-mauve)] font-medium">
        Snapped to {snapType || 'grid'} {snapTime && `(${formatTime(snapTime)})`}
      </span>
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
