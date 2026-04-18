import React, { useCallback, useRef } from 'react'

export type TrimHandleSide = 'left' | 'right'

interface TrimHandleProps {
  side: TrimHandleSide
  zoom: number
  onTrimStart: (side: TrimHandleSide, startTime: number) => void
  onTrimMove: (deltaTime: number, side: TrimHandleSide) => void
  onTrimEnd: () => void
  disabled?: boolean
}

export const TRIM_HANDLE_WIDTH = 12

export function TrimHandle({ side, zoom, onTrimStart, onTrimMove, onTrimEnd, disabled = false }: TrimHandleProps) {
  const isDragging = useRef(false)
  const dragStartX = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return

    isDragging.current = true
    dragStartX.current = e.clientX

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return

      const deltaX = moveEvent.clientX - dragStartX.current
      const deltaTime = deltaX / zoom
      onTrimMove(deltaTime, side)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      onTrimEnd()
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    onTrimStart(side, 0)
  }, [side, zoom, onTrimStart, onTrimMove, onTrimEnd, disabled])

  if (disabled) return null

  return (
    <div
      className="absolute top-0 bottom-0 hover:bg-[var(--ctp-mauve)]/30 transition-colors"
      style={{
        [side]: -TRIM_HANDLE_WIDTH / 2,
        width: TRIM_HANDLE_WIDTH,
        cursor: side === 'left' ? 'w-resize' : 'e-resize',
      }}
      onMouseDown={handleMouseDown}
      title={`Trim ${side} edge`}
    >
      {/* Visual handle indicator */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 w-1 h-6 bg-[var(--ctp-subtext)] rounded ${
          side === 'left' ? 'left-1' : 'right-1'
        }`}
      />
    </div>
  )
}
