import { useState, useCallback, useRef } from 'react'

export type PanelPosition = 'left' | 'right' | 'bottom'

interface Props {
  children: React.ReactNode
  position?: PanelPosition
  initialSize?: number
  minSize?: number
  maxSize?: number
  collapsible?: boolean
  onResize?: (size: number) => void
  className?: string
}

/**
 * Resizable panel that can be docked to any side.
 * Supports horizontal (left/right) and vertical (bottom) resizing.
 */
export function ResizablePanel({
  children,
  position = 'right',
  initialSize = 300,
  minSize = 200,
  maxSize = 600,
  collapsible = true,
  onResize,
  className = '',
}: Props) {
  const [size, setSize] = useState(initialSize)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const isResizing = useRef(false)
  const resizeStartSize = useRef(initialSize)
  const resizeStartPos = useRef(0)

  const isHorizontal = position === 'left' || position === 'right'

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    resizeStartSize.current = size
    resizeStartPos.current = isHorizontal ? e.clientX : e.clientY

    const handleResizeMove = (moveEvent: MouseEvent) => {
      if (!isResizing.current) return

      const delta = (isHorizontal ? moveEvent.clientX : moveEvent.clientY) - resizeStartPos.current
      const direction = position === 'left' || position === 'bottom' ? 1 : -1
      const newSize = resizeStartSize.current + (delta * direction)

      const clampedSize = Math.max(minSize, Math.min(maxSize, newSize))
      setSize(clampedSize)
      onResize?.(clampedSize)
    }

    const handleResizeEnd = () => {
      isResizing.current = false
      document.removeEventListener('mousemove', handleResizeMove)
      document.removeEventListener('mouseup', handleResizeEnd)
    }

    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)
  }, [size, isHorizontal, position, minSize, maxSize, onResize])

  const handleToggleCollapse = useCallback(() => {
    if (isCollapsed) {
      setSize(initialSize)
      onResize?.(initialSize)
    }
    setIsCollapsed(!isCollapsed)
  }, [isCollapsed, initialSize, onResize])

  const panelStyle: React.CSSProperties = {
    [isHorizontal ? 'width' : 'height']: isCollapsed ? 0 : size,
    [isHorizontal ? 'minWidth' : 'minHeight']: collapsible ? 0 : minSize,
    [isHorizontal ? 'maxWidth' : 'maxHeight']: maxSize,
    flexShrink: 0,
    overflow: 'hidden',
  }

  const resizeHandleCursor = isHorizontal
    ? 'cursor-ew-resize'
    : 'cursor-ns-resize'

  return (
    <div
      className={`flex ${position === 'bottom' ? 'flex-col' : ''} ${className}`}
      style={{ overflow: 'hidden' }}
    >
      {/* Panel content */}
      <div
        className={`transition-opacity duration-150 ${isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={panelStyle}
      >
        {children}
      </div>

      {/* Resize handle */}
      {!isCollapsed && collapsible && (
        <div
          className={`relative z-10 flex items-center justify-center bg-[var(--ctp-surface)] border-[var(--ctp-overlay)] hover:bg-[var(--ctp-mauve-10)] transition-colors group ${
            isHorizontal
              ? 'w-1.5 border-l'
              : 'h-1.5 border-t'
          } ${resizeHandleCursor}`}
          onMouseDown={handleResizeStart}
          role="separator"
          aria-label={`Resize ${position} panel`}
          aria-valuenow={size}
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

          {/* Collapse button (on hover) */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleToggleCollapse()
            }}
            className="absolute opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[var(--ctp-mauve)] hover:text-[var(--ctp-base)]"
            style={{ [isHorizontal ? 'top' : 'left']: '50%', [isHorizontal ? 'transform' : 'transform']: 'translate(-50%, -50%)' }}
            aria-label={isCollapsed ? 'Expand panel' : 'Collapse panel'}
          >
            <svg
              className={`w-3 h-3 transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={
                position === 'right' ? 'M15 19l-7-7 7-7' :
                position === 'left' ? 'M9 5l7 7-7 7' :
                position === 'bottom' ? 'M19 9l-7 7-7-7' :
                'M5 15l7-7 7 7'
              } />
            </svg>
          </button>
        </div>
      )}

      {/* Collapsed state indicator */}
      {isCollapsed && collapsible && (
        <button
          onClick={handleToggleCollapse}
          className={`flex items-center justify-center bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] hover:bg-[var(--ctp-mauve-10)] transition-colors ${
            isHorizontal ? 'w-4' : 'h-4'
          }`}
          aria-label={`Expand ${position} panel`}
        >
          <svg
            className={`w-3 h-3 text-[var(--ctp-subtext)] ${
              position === 'right' ? 'rotate-180' :
              position === 'bottom' ? '-rotate-90' :
              position === 'left' ? 'rotate-0' : 'rotate-90'
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
    </div>
  )
}

/**
 * Floating panel that can be dragged around and docked to edges.
 */
interface FloatingPanelProps {
  children: React.ReactNode
  title?: string
  initialPosition?: { x: number; y: number }
  defaultDockPosition?: PanelPosition | null
  onClose?: () => void
  onDock?: (position: PanelPosition | null) => void
}

export function FloatingPanel({
  children,
  title,
  initialPosition = { x: 100, y: 100 },
  defaultDockPosition = null,
  onClose,
  onDock,
}: FloatingPanelProps) {
  const [position, setPosition] = useState(initialPosition)
  const [isDragging, setIsDragging] = useState(false)
  const [dockPosition, setDockPosition] = useState<PanelPosition | null>(defaultDockPosition)
  const dragStart = useRef({ x: 0, y: 0 })
  const panelStart = useRef({ x: 0, y: 0 })

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY }
    panelStart.current = { ...position }

    const handleDragMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - dragStart.current.x
      const dy = moveEvent.clientY - dragStart.current.y
      setPosition({ x: panelStart.current.x + dx, y: panelStart.current.y + dy })
    }

    const handleDragEnd = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', handleDragMove)
      document.removeEventListener('mouseup', handleDragEnd)
    }

    document.addEventListener('mousemove', handleDragMove)
    document.addEventListener('mouseup', handleDragEnd)
  }, [position])

  const handleDock = useCallback((newPosition: PanelPosition) => {
    setDockPosition(newPosition)
    onDock?.(newPosition)
  }, [onDock])

  // If docked, render as ResizablePanel
  if (dockPosition) {
    return (
      <ResizablePanel position={dockPosition} initialSize={300}>
        <div className="h-full flex flex-col">
          {title && (
            <div className="flex items-center justify-between p-3 border-b border-[var(--ctp-overlay)]">
              <h3 className="text-sm font-semibold text-[var(--ctp-text)]">{title}</h3>
              <button
                onClick={() => setDockPosition(null)}
                className="btn-ghost p-1 rounded"
                aria-label="Undock panel"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </button>
            </div>
          )}
          <div className="flex-1 overflow-auto">{children}</div>
        </div>
      </ResizablePanel>
    )
  }

  // Floating panel
  return (
    <div
      className="glass-card absolute z-50 min-w-[280px] max-w-md shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
        opacity: isDragging ? 0.9 : 1,
        transform: isDragging ? 'scale(1.02)' : 'scale(1)',
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between p-3 border-b border-[var(--ctp-overlay)] cursor-move"
        onMouseDown={handleDragStart}
      >
        {title && <h3 className="text-sm font-semibold text-[var(--ctp-text)]">{title}</h3>}
        <div className="flex items-center gap-1">
          {/* Dock buttons */}
          <div className="flex items-center gap-0.5 mr-2">
            <button
              onClick={() => handleDock('left')}
              className="p-1 rounded hover:bg-[var(--ctp-surface-1)]"
              aria-label="Dock to left"
              title="Dock to left"
            >
              <svg className="w-3.5 h-3.5 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h2v16H4V4zm4 0h12v16H8V4z" />
              </svg>
            </button>
            <button
              onClick={() => handleDock('right')}
              className="p-1 rounded hover:bg-[var(--ctp-surface-1)]"
              aria-label="Dock to right"
              title="Dock to right"
            >
              <svg className="w-3.5 h-3.5 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 4h2v16h-2V4zM4 4h12v16H4V4z" />
              </svg>
            </button>
            <button
              onClick={() => handleDock('bottom')}
              className="p-1 rounded hover:bg-[var(--ctp-surface-1)]"
              aria-label="Dock to bottom"
              title="Dock to bottom"
            >
              <svg className="w-3.5 h-3.5 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 18h16v2H4v-2zm0-14h16v12H4V4z" />
              </svg>
            </button>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="btn-ghost p-1 rounded"
              aria-label="Close panel"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 max-h-[60vh] overflow-auto">
        {children}
      </div>
    </div>
  )
}
