import React, { useCallback } from 'react'
import type { TrackSegment, CropBox } from '../../types'

interface PropertiesPanelProps {
  selectedSegment: TrackSegment | null
  selectedTrackType?: string
  avatarCrop?: CropBox
  gameplayCrop?: CropBox
  currentTime: number
  duration: number
  onUpdateSegment: (patch: Partial<TrackSegment>) => void
  onCropChange?: (avatar: CropBox, gameplay: CropBox) => void
}

export function PropertiesPanel({
  selectedSegment,
  selectedTrackType,
  avatarCrop,
  gameplayCrop,
  currentTime,
  duration,
  onUpdateSegment,
  onCropChange,
}: PropertiesPanelProps) {
  // Timing section
  const handleTimeChange = useCallback((field: 'start' | 'end', value: number) => {
    if (!selectedSegment) return
    onUpdateSegment({ [field]: value })
  }, [selectedSegment, onUpdateSegment])

  // Crop section
  const handleCropChange = useCallback((type: 'avatar' | 'gameplay', field: keyof CropBox, value: number) => {
    if (!onCropChange) return
    if (type === 'avatar' && avatarCrop) {
      onCropChange({ ...avatarCrop, [field]: value }, gameplayCrop!)
    } else if (type === 'gameplay' && gameplayCrop) {
      onCropChange(avatarCrop!, { ...gameplayCrop, [field]: value })
    }
  }, [avatarCrop, gameplayCrop, onCropChange])

  // No selection
  if (!selectedSegment && !selectedTrackType) {
    return (
      <div className="p-4 text-sm text-[var(--ctp-subtext)]">
        Select a segment to edit its properties
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Timing Section */}
      <div className="border-b border-[var(--ctp-overlay)]">
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--ctp-surface)]">
          <svg className="w-4 h-4 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium text-[var(--ctp-text)]">Timing</span>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--ctp-subtext)] w-16">Start</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max={duration}
              value={selectedSegment?.start ?? 0}
              onChange={(e) => handleTimeChange('start', parseFloat(e.target.value))}
              className="flex-1 bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded px-2 py-1 text-sm text-[var(--ctp-text)]"
            />
            <span className="text-xs text-[var(--ctp-subtext)]">s</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--ctp-subtext)] w-16">End</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max={duration}
              value={selectedSegment?.end ?? 0}
              onChange={(e) => handleTimeChange('end', parseFloat(e.target.value))}
              className="flex-1 bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded px-2 py-1 text-sm text-[var(--ctp-text)]"
            />
            <span className="text-xs text-[var(--ctp-subtext)]">s</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--ctp-subtext)] w-16">Duration</label>
            <span className="text-sm text-[var(--ctp-text)]">
              {selectedSegment ? (selectedSegment.end - selectedSegment.start).toFixed(2) : '0.00'}s
            </span>
          </div>
        </div>
      </div>

      {/* Crop Section (for avatar/gameplay tracks) */}
      {selectedTrackType === 'avatar' && avatarCrop && onCropChange && (
        <div className="border-b border-[var(--ctp-overlay)]">
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--ctp-surface)]">
            <svg className="w-4 h-4 text-[var(--ctp-blue)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-sm font-medium text-[var(--ctp-text)]">Avatar Crop</span>
          </div>
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--ctp-subtext)] w-8">X</label>
              <input
                type="number"
                step="1"
                min="0"
                value={avatarCrop.x}
                onChange={(e) => handleCropChange('avatar', 'x', parseInt(e.target.value))}
                className="flex-1 bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded px-2 py-1 text-sm text-[var(--ctp-text)]"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--ctp-subtext)] w-8">Y</label>
              <input
                type="number"
                step="1"
                min="0"
                value={avatarCrop.y}
                onChange={(e) => handleCropChange('avatar', 'y', parseInt(e.target.value))}
                className="flex-1 bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded px-2 py-1 text-sm text-[var(--ctp-text)]"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--ctp-subtext)] w-8">W</label>
              <input
                type="number"
                step="1"
                min="1"
                value={avatarCrop.w}
                onChange={(e) => handleCropChange('avatar', 'w', parseInt(e.target.value))}
                className="flex-1 bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded px-2 py-1 text-sm text-[var(--ctp-text)]"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--ctp-subtext)] w-8">H</label>
              <input
                type="number"
                step="1"
                min="1"
                value={avatarCrop.h}
                onChange={(e) => handleCropChange('avatar', 'h', parseInt(e.target.value))}
                className="flex-1 bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded px-2 py-1 text-sm text-[var(--ctp-text)]"
              />
            </div>
          </div>
        </div>
      )}

      {selectedTrackType === 'gameplay' && gameplayCrop && onCropChange && (
        <div className="border-b border-[var(--ctp-overlay)]">
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--ctp-surface)]">
            <svg className="w-4 h-4 text-[var(--ctp-green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-sm font-medium text-[var(--ctp-text)]">Gameplay Crop</span>
          </div>
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--ctp-subtext)] w-8">X</label>
              <input
                type="number"
                step="1"
                min="0"
                value={gameplayCrop.x}
                onChange={(e) => handleCropChange('gameplay', 'x', parseInt(e.target.value))}
                className="flex-1 bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded px-2 py-1 text-sm text-[var(--ctp-text)]"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--ctp-subtext)] w-8">Y</label>
              <input
                type="number"
                step="1"
                min="0"
                value={gameplayCrop.y}
                onChange={(e) => handleCropChange('gameplay', 'y', parseInt(e.target.value))}
                className="flex-1 bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded px-2 py-1 text-sm text-[var(--ctp-text)]"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--ctp-subtext)] w-8">W</label>
              <input
                type="number"
                step="1"
                min="1"
                value={gameplayCrop.w}
                onChange={(e) => handleCropChange('gameplay', 'w', parseInt(e.target.value))}
                className="flex-1 bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded px-2 py-1 text-sm text-[var(--ctp-text)]"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--ctp-subtext)] w-8">H</label>
              <input
                type="number"
                step="1"
                min="1"
                value={gameplayCrop.h}
                onChange={(e) => handleCropChange('gameplay', 'h', parseInt(e.target.value))}
                className="flex-1 bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded px-2 py-1 text-sm text-[var(--ctp-text)]"
              />
            </div>
          </div>
        </div>
      )}

      {/* Subtitle Text Section */}
      {selectedSegment?.type === 'subtitle' && (
        <div className="border-b border-[var(--ctp-overlay)]">
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--ctp-surface)]">
            <svg className="w-4 h-4 text-[var(--ctp-mauve)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            <span className="text-sm font-medium text-[var(--ctp-text)]">Subtitle Text</span>
          </div>
          <div className="p-3">
            <textarea
              value={selectedSegment.text ?? ''}
              onChange={(e) => onUpdateSegment({ text: e.target.value })}
              className="w-full h-24 bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded px-2 py-1 text-sm text-[var(--ctp-text)] resize-none"
              placeholder="Enter subtitle text..."
            />
          </div>
        </div>
      )}

      {/* Info Section */}
      <div className="border-b border-[var(--ctp-overlay)]">
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--ctp-surface)]">
          <svg className="w-4 h-4 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium text-[var(--ctp-text)]">Info</span>
        </div>
        <div className="p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--ctp-subtext)]">Type</span>
            <span className="text-xs text-[var(--ctp-text)] capitalize">{selectedSegment?.type ?? selectedTrackType}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--ctp-subtext)]">ID</span>
            <span className="text-xs text-[var(--ctp-text)] font-mono">{selectedSegment?.id.slice(0, 8)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
