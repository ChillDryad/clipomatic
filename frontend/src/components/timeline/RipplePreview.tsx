interface RippleSegment {
  segmentId: string
  originalStart: number
  newStart: number
  label?: string
}

interface Props {
  affectedSegments: RippleSegment[]
  pxPerSecond: number
  delta: number
  visible: boolean
}

/**
 * Shows which segments will be affected by a ripple edit operation.
 * Displays arrows indicating the direction and magnitude of the shift.
 */
export function RipplePreview({ affectedSegments, pxPerSecond, delta, visible }: Props) {
  if (!visible || affectedSegments.length === 0) return null

  const isPositive = delta > 0
  const arrowColor = isPositive ? '#a6e3a1' : '#f38ba8' // green for gap created, red for gap closed

  return (
    <>
      {affectedSegments.map((segment) => {
        const originalX = segment.originalStart * pxPerSecond
        const newX = segment.newStart * pxPerSecond
        const shiftPixels = newX - originalX

        return (
          <div
            key={segment.segmentId}
            className="absolute pointer-events-none z-20"
            style={{
              left: Math.min(originalX, newX),
              width: Math.abs(shiftPixels) + 20,
              top: 0,
              bottom: 0,
            }}
          >
            {/* Shift indicator overlay */}
            <div
              className={`absolute top-1 bottom-1 rounded opacity-30 ${
                isPositive ? 'bg-[var(--ctp-green)]' : 'bg-[var(--ctp-red)]'
              }`}
              style={{
                left: isPositive ? 0 : Math.abs(shiftPixels),
                width: Math.abs(shiftPixels),
              }}
              aria-hidden="true"
            />

            {/* Direction arrow */}
            <div
              className="absolute top-1/2 -translate-y-1/2"
              style={{
                left: isPositive ? Math.abs(shiftPixels) - 10 : 0,
              }}
            >
              <svg
                className="w-4 h-4"
                style={{ color: arrowColor }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={isPositive ? 'M13 7l5 5m0 0l-5 5m5-5H6' : 'M11 17l-5-5m0 0l5-5m-5 5h12'}
                />
              </svg>
            </div>

            {/* Shift amount label */}
            <div
              className="absolute -top-5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--ctp-base)] border border-[var(--ctp-overlay)]"
              style={{
                left: Math.abs(shiftPixels) / 2 - 20,
                color: arrowColor,
              }}
            >
              {delta > 0 ? '+' : ''}{delta.toFixed(2)}s
            </div>

            {/* Segment label (optional) */}
            {segment.label && (
              <div
                className="absolute -bottom-5 text-[10px] text-[var(--ctp-subtext)] whitespace-nowrap"
                style={{
                  left: Math.abs(shiftPixels) / 2 - segment.label.length * 3,
                }}
              >
                {segment.label}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * Simple ripple indicator badge showing that ripple mode is active.
 */
export function RippleModeBadge({ enabled }: { enabled: boolean }) {
  if (!enabled) return null

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--ctp-peach-20)] border border-[var(--ctp-peach-30)]">
      <svg className="w-3.5 h-3.5 text-[var(--ctp-peach)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
      <span className="text-[11px] text-[var(--ctp-peach)] font-medium">Ripple</span>
    </div>
  )
}
