import { useState, useCallback, useRef } from 'react'

export type SplitDirection = 'horizontal' | 'vertical'

// Helper to get rotation transform for collapse buttons
function getRotation(isCollapsed: 'first' | 'second' | null, isHorizontal: boolean, panel: 'first' | 'second'): string {
  if (isCollapsed === panel) {
    return isHorizontal ? 'rotate(0deg)' : 'rotate(90deg)'
  }
  return isHorizontal ? 'rotate(180deg)' : 'rotate(270deg)'
}

// Helper to get aria-label for collapse buttons
function getCollapseAriaLabel(isCollapsed: 'first' | 'second' | null, panel: 'first' | 'second'): string {
  const isPanelCollapsed = isCollapsed === panel
  return isPanelCollapsed ? `Expand ${panel} panel` : `Collapse ${panel} panel`
}

interface Props {
  children: [React.ReactNode, React.ReactNode]
  direction?: SplitDirection
  initialSize?: number // percentage 0-100
  minSize?: number // percentage
  maxSize?: number // percentage
  onResize?: (size: number) => void
  className?: string
  collapsible?: boolean
}

/**
 * Split view container for side-by-side or top-bottom layouts.
 * Useful for timeline + preview split view.
 */
export function SplitView({
  children,
  direction = 'horizontal',
  initialSize = 50,
  minSize = 20,
  maxSize = 80,
  onResize,
  className = '',
  collapsible = true,
}: Props) {
  const [splitSize, setSplitSize] = useState(initialSize)
  const [isCollapsed, setIsCollapsed] = useState<'first' | 'second' | null>(null)
  const isResizing = useRef(false)
  const resizeStartSize = useRef(initialSize)
  const resizeStartPos = useRef(0)

  const isHorizontal = direction === 'horizontal'

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    resizeStartSize.current = splitSize
    resizeStartPos.current = isHorizontal ? e.clientX : e.clientY

    const container = e.currentTarget.parentElement as HTMLElement | null
    const containerSize = container ? (isHorizontal ? container.clientWidth : container.clientHeight) : 1

    const handleResizeMove = (moveEvent: MouseEvent) => {
      if (!isResizing.current) return

      const delta = (isHorizontal ? moveEvent.clientX : moveEvent.clientY) - resizeStartPos.current
      const deltaPercent = (delta / containerSize) * 100
      const newSize = resizeStartSize.current + deltaPercent

      const clampedSize = Math.max(minSize, Math.min(maxSize, newSize))
      setSplitSize(clampedSize)
      onResize?.(clampedSize)
    }

    const handleResizeEnd = () => {
      isResizing.current = false
      document.removeEventListener('mousemove', handleResizeMove)
      document.removeEventListener('mouseup', handleResizeEnd)
    }

    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)
  }, [splitSize, isHorizontal, minSize, maxSize, onResize])

  const handleToggleCollapse = useCallback((which: 'first' | 'second') => {
    if (isCollapsed === which) {
      setSplitSize(initialSize)
      setIsCollapsed(null)
    } else {
      setIsCollapsed(which)
    }
  }, [isCollapsed, initialSize])

  const firstPanelStyle: React.CSSProperties = {
    [isHorizontal ? 'width' : 'height']: isCollapsed === 'first' ? 0 : `${splitSize}%`,
    [isHorizontal ? 'minWidth' : 'minHeight']: collapsible ? 0 : `${minSize}%`,
    flexShrink: 0,
    overflow: 'hidden',
  }

  const secondPanelStyle: React.CSSProperties = {
    flex: 1,
    overflow: 'hidden',
    opacity: isCollapsed === 'second' ? 0 : 1,
  }

  return (
    <div className={`flex ${isHorizontal ? 'flex-row' : 'flex-col'} ${className}`}>
      {/* First panel */}
      <div
        className={`transition-opacity duration-150 ${isCollapsed === 'first' ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={firstPanelStyle}
      >
        {children[0]}
      </div>

      {/* Resize handle */}
      {isCollapsed !== 'first' && (
        <div
          className={`relative z-10 flex items-center justify-center bg-[var(--ctp-surface)] border-[var(--ctp-overlay)] hover:bg-[var(--ctp-mauve-10)] transition-colors group ${
            isHorizontal
              ? 'w-1.5 border-l h-full'
              : 'h-1.5 border-t w-full'
          } ${isHorizontal ? 'cursor-ew-resize' : 'cursor-ns-resize'}`}
          onMouseDown={handleResizeStart}
          role="separator"
          aria-label={`Resize ${direction} split`}
          aria-valuenow={splitSize}
          aria-valuemin={minSize}
          aria-valuemax={maxSize}
        >
          {/* Handle grip */}
          <div className={`flex gap-0.5 ${isHorizontal ? 'flex-col' : 'flex-row'}`}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className={`bg-[var(--ctp-subtext)] opacity-50 group-hover:opacity-80 transition-opacity ${
                  isHorizontal ? 'w-3 h-0.5 rounded-full' : 'h-3 w-0.5 rounded-full'
                }`}
              />
            ))}
          </div>

          {/* Collapse buttons */}
          {collapsible && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleToggleCollapse('first')
                }}
                className={`absolute opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[var(--ctp-mauve)] hover:text-[var(--ctp-base)] ${
                  isHorizontal ? 'top-1/2 -translate-y-1/2' : 'left-1/2 -translate-x-1/2'
                } ${isHorizontal ? '-left-6' : '-top-6'}`}
                aria-label={getCollapseAriaLabel(isCollapsed, 'first')}
              >
                <svg
                  className="w-3 h-3 transition-transform"
                  style={{ transform: getRotation(isCollapsed, isHorizontal, 'first') }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleToggleCollapse('second')
                }}
                className={`absolute opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[var(--ctp-mauve)] hover:text-[var(--ctp-base)] ${
                  isHorizontal ? 'top-1/2 -translate-y-1/2' : 'left-1/2 -translate-x-1/2'
                } ${isHorizontal ? '-right-6' : '-bottom-6'}`}
                aria-label={isCollapsed === 'second' ? 'Expand second panel' : 'Collapse second panel'}
              >
                <svg
                  className="w-3 h-3 transition-transform"
                  style={{ transform: getRotation(isCollapsed, isHorizontal, 'second') }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </>
          )}
        </div>
      )}

      {/* Second panel */}
      <div style={secondPanelStyle}>
        {children[1]}
      </div>
    </div>
  )
}

/**
 * Preset layouts for common split view configurations.
 */
interface SplitLayoutProps {
  timeline: React.ReactNode
  preview: React.ReactNode
  properties?: React.ReactNode
  showProperties?: boolean
}

export function TimelineSplitLayout({ timeline, preview, properties, showProperties = false }: SplitLayoutProps) {
  return (
    <SplitView direction="horizontal" initialSize={60} minSize={30} maxSize={70}>
      {/* Left: Timeline */}
      <div className="h-full overflow-hidden">
        {timeline}
      </div>

      {/* Right: Preview + optional Properties */}
      <SplitView direction="vertical" initialSize={70} minSize={20} maxSize={90}>
        {/* Top: Preview */}
        <div className="h-full overflow-hidden">
          {preview}
        </div>

        {/* Bottom: Properties (if shown) */}
        {showProperties && properties && (
          <div className="h-full overflow-auto">
            {properties}
          </div>
        )}
      </SplitView>
    </SplitView>
  )
}
