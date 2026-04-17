import { useCallback } from 'react'

export type TrackType = 'avatar' | 'gameplay' | 'subtitle' | 'overlay' | 'audio' | 'text' | 'marker'

interface TrackColor {
  bg: string
  border: string
  text: string
}

const TRACK_COLORS: Record<TrackType, TrackColor> = {
  avatar: { bg: 'rgba(137, 180, 250, 0.2)', border: '#89b4fa', text: '#89b4fa' },
  gameplay: { bg: 'rgba(203, 166, 247, 0.2)', border: '#cba6f7', text: '#cba6f7' },
  subtitle: { bg: 'rgba(166, 227, 161, 0.2)', border: '#a6e3a1', text: '#a6e3a1' },
  overlay: { bg: 'rgba(250, 179, 135, 0.2)', border: '#fab387', text: '#fab387' },
  audio: { bg: 'rgba(243, 139, 168, 0.2)', border: '#f38ba8', text: '#f38ba8' },
  text: { bg: 'rgba(249, 226, 175, 0.2)', border: '#f9e2af', text: '#f9e2af' },
  marker: { bg: 'rgba(137, 180, 250, 0.15)', border: '#89b4fa', text: '#89b4fa' },
}

const TRACK_ICONS: Record<TrackType, string> = {
  avatar: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  gameplay: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  subtitle: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z',
  overlay: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  audio: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3',
  text: 'M4 6h16M4 12h16M4 18h7',
  marker: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z',
}

interface Props {
  type: TrackType
  label: string
  visible: boolean
  locked: boolean
  volume?: number
  collapsed?: boolean
  onToggleVisible: () => void
  onToggleLocked: () => void
  onVolumeChange?: (volume: number) => void
  onCollapse?: () => void
  onDelete?: () => void
  height?: number
  onHeightChange?: (height: number) => void
}

export function TrackHeader({
  type,
  label,
  visible,
  locked,
  volume,
  collapsed = false,
  onToggleVisible,
  onToggleLocked,
  onVolumeChange,
  onCollapse,
  onDelete,
  height = 48,
  onHeightChange,
}: Props) {
  const colors = TRACK_COLORS[type]
  const iconPath = TRACK_ICONS[type]

  const handleHeightDrag = useCallback((e: React.MouseEvent) => {
    if (!onHeightChange) return
    e.preventDefault()
    e.stopPropagation()

    const startY = e.clientY
    const startHeight = height

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY
      const newHeight = Math.max(32, Math.min(200, startHeight + deltaY))
      onHeightChange(newHeight)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [height, onHeightChange])

  return (
    <div
      className="w-48 flex-shrink-0 flex flex-col bg-[var(--ctp-surface)] border-r border-[var(--ctp-overlay)] select-none"
      style={{ minHeight: height }}
      role="group"
      aria-label={`${label} track header`}
    >
      {/* Main header row */}
      <div className="flex items-center gap-2 px-2 py-2 border-b border-[var(--ctp-overlay)]">
        {/* Color indicator & icon */}
        <div
          className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}
          aria-hidden="true"
        >
          <svg className="w-3.5 h-3.5" style={{ color: colors.text }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
          </svg>
        </div>

        {/* Label */}
        <span className="text-xs font-medium text-[var(--ctp-text)] truncate flex-1" title={label}>
          {label}
        </span>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        {/* Visibility toggle */}
        <button
          onClick={onToggleVisible}
          aria-label={`${visible ? 'Hide' : 'Show'} ${label} track`}
          aria-pressed={visible}
          className={`p-1 rounded transition-colors ${
            visible
              ? 'text-[var(--ctp-text)] hover:bg-[var(--ctp-surface-1)]'
              : 'text-[var(--ctp-subtext)] hover:bg-[var(--ctp-surface-1)]'
          }`}
          style={{ minWidth: 28, minHeight: 28 }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {visible ? (
              <>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </>
            ) : (
              <>
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                <path d="M1 1l22 22" />
              </>
            )}
          </svg>
        </button>

        {/* Lock toggle */}
        <button
          onClick={onToggleLocked}
          aria-label={`${locked ? 'Unlock' : 'Lock'} ${label} track`}
          aria-pressed={locked}
          className={`p-1 rounded transition-colors ${
            locked
              ? 'text-[var(--ctp-mauve)] hover:bg-[var(--ctp-surface-1)]'
              : 'text-[var(--ctp-subtext)] hover:bg-[var(--ctp-surface-1)]'
          }`}
          style={{ minWidth: 28, minHeight: 28 }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {locked ? (
              <>
                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                <path d="M8 11V7a4 4 0 118 0v4" />
              </>
            ) : (
              <>
                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                <path d="M8 11V7a4 4 0 118 0v4H8z" />
              </>
            )}
          </svg>
        </button>

        {/* Collapse button (if collapsible) */}
        {onCollapse && (
          <button
            onClick={onCollapse}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label} track`}
            className={`p-1 rounded transition-colors text-[var(--ctp-subtext)] hover:bg-[var(--ctp-surface-1)]`}
            style={{ minWidth: 28, minHeight: 28 }}
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}

        {/* Volume slider (for audio tracks) */}
        {onVolumeChange && volume !== undefined && (
          <div className="flex items-center gap-1 flex-1 ml-1">
            <svg className="w-3 h-3 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 010 7.07" />
            </svg>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(volume * 100)}
              onChange={(e) => onVolumeChange(parseInt(e.target.value) / 100)}
              className="flex-1 h-1 rounded-full appearance-none bg-[var(--ctp-overlay)] accent-[var(--ctp-mauve)]"
              aria-label={`${label} volume`}
            />
          </div>
        )}

        {/* Delete button */}
        {onDelete && (
          <button
            onClick={onDelete}
            aria-label={`Delete ${label} track`}
            className="p-1 rounded text-[var(--ctp-subtext)] hover:text-[var(--ctp-red)] hover:bg-[var(--ctp-surface-1)] transition-colors"
            style={{ minWidth: 28, minHeight: 28 }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {/* Height resize handle */}
      {onHeightChange && (
        <div
          className="h-2 cursor-ns-resize flex items-center justify-center hover:bg-[var(--ctp-mauve-10)] transition-colors"
          onMouseDown={handleHeightDrag}
          aria-label="Drag to resize track height"
          title="Drag to resize track height"
        >
          <div className="w-8 h-px bg-[var(--ctp-overlay)]" />
        </div>
      )}
    </div>
  )
}
