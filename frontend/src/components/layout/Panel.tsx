import React, { useCallback, useRef, useState } from 'react'

interface PanelProps {
  position: 'left' | 'right' | 'bottom'
  size: number // percentage for left/right, pixels for bottom
  onSizeChange?: (size: number) => void
  visible: boolean
  minimized: boolean
  collapsed: boolean
  onToggleMinimize?: () => void
  onToggleCollapse?: () => void
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
  minSize?: number
  maxSize?: number
}

export function Panel({
  position,
  size,
  onSizeChange,
  visible,
  minimized,
  collapsed,
  onToggleMinimize,
  onToggleCollapse,
  title,
  icon,
  children,
  className = '',
  minSize = 150,
  maxSize = 600,
}: PanelProps) {
  const isDragging = useRef(false)
  const dragStartPos = useRef(0)
  const dragStartSize = useRef(0)

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    dragStartPos.current = position === 'bottom' ? e.clientY : e.clientX
    dragStartSize.current = size
    document.body.style.cursor = position === 'bottom' ? 'ns-resize' : 'ew-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current || !onSizeChange) return

      const delta = position === 'bottom'
        ? moveEvent.clientY - dragStartPos.current
        : dragStartPos.current - moveEvent.clientX // Invert for left panel

      let newSize = dragStartSize.current + delta

      // Apply constraints
      if (position === 'bottom') {
        // Pixels for bottom
        newSize = Math.max(minSize, Math.min(maxSize, newSize))
      } else {
        // Percentage for left/right (assume 1920px viewport for calculation)
        const deltaPercent = (delta / window.innerWidth) * 100
        newSize = Math.max(10, Math.min(50, dragStartSize.current + deltaPercent))
      }

      onSizeChange(newSize)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [position, size, onSizeChange, minSize, maxSize])

  if (!visible) return null

  // Minimized state - show as thin strip with icon
  if (minimized) {
    return (
      <div
        className={`flex ${position === 'bottom' ? 'h-10 flex-row' : 'w-10 flex-col'} items-center justify-center bg-[var(--ctp-surface)] border-[var(--ctp-overlay)] ${
          position === 'left' ? 'border-r' : position === 'right' ? 'border-l' : 'border-t'
        } ${className}`}
      >
        <button
          onClick={onToggleMinimize}
          className="p-2 hover:bg-[var(--ctp-overlay)] rounded transition-colors"
          title={`Expand ${title}`}
        >
          {icon || <span className="text-xs text-[var(--ctp-subtext)]">{title[0]}</span>}
        </button>
      </div>
    )
  }

  // Collapsed state - show header only
  if (collapsed) {
    return (
      <div
        className={`bg-[var(--ctp-surface)] border-[var(--ctp-overlay)] ${
          position === 'left' ? 'border-r' : position === 'right' ? 'border-l' : 'border-t'
        } ${className}`}
        style={{
          [position === 'bottom' ? 'height' : 'width']: position === 'bottom' ? '40px' : '200px',
        }}
      >
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            {icon}
            <span className="text-sm font-medium text-[var(--ctp-text)]">{title}</span>
          </div>
          <button
            onClick={onToggleCollapse}
            className="p-1 hover:bg-[var(--ctp-overlay)] rounded transition-colors"
          >
            <svg className="w-4 h-4 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  const sizeStyle = position === 'bottom'
    ? { height: `${size}px` }
    : { width: `${size}%` }

  return (
    <div
      className={`flex flex-col bg-[var(--ctp-surface)] border-[var(--ctp-overlay)] relative ${
        position === 'left' ? 'border-r' : position === 'right' ? 'border-l' : 'border-t'
      } ${className}`}
      style={sizeStyle}
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--ctp-overlay)] bg-[var(--ctp-surface)]">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-[var(--ctp-text)]">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleCollapse}
            className="p-1 hover:bg-[var(--ctp-overlay)] rounded transition-colors"
            title="Collapse"
          >
            <svg className="w-4 h-4 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={onToggleMinimize}
            className="p-1 hover:bg-[var(--ctp-overlay)] rounded transition-colors"
            title="Minimize"
          >
            <svg className="w-4 h-4 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Panel Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {children}
      </div>

      {/* Resize Handle */}
      {onSizeChange && (
        <div
          className={`absolute ${
            position === 'left' ? '-right-1 cursor-ew-resize w-2' :
            position === 'right' ? '-left-1 cursor-ew-resize w-2' :
            '-top-1 cursor-ns-resize h-2'
          } hover:bg-[var(--ctp-mauve)]/30 transition-colors z-10`}
          onMouseDown={handleDragStart}
        />
      )}
    </div>
  )
}
