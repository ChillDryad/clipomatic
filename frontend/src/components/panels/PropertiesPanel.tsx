import { useState, useMemo } from 'react'
import type { TrackSegment, CropBox } from '../../types'
import type { TrackType } from '../timeline/TrackHeader'
import { ColorPicker } from '../ui/ColorPicker'

interface BaseProperties {
  type: 'segment' | 'track' | 'marker' | 'timeline'
}

interface SegmentProperties extends BaseProperties {
  type: 'segment'
  segment: TrackSegment
  trackType: TrackType
  onUpdate: (patch: Partial<TrackSegment>) => void
}

interface TrackProperties extends BaseProperties {
  type: 'track'
  trackId: string
  trackType: TrackType
  label: string
  volume?: number
  opacity?: number
  visible: boolean
  locked: boolean
  onUpdate: (patch: { label?: string; volume?: number; opacity?: number; visible?: boolean; locked?: boolean }) => void
}

interface MarkerProperties extends BaseProperties {
  type: 'marker'
  markerId: string
  time: number
  label: string
  color: string
  duration?: number
  onUpdate: (patch: { time?: number; label?: string; color?: string; duration?: number }) => void
}

interface TimelineProperties extends BaseProperties {
  type: 'timeline'
  duration: number
  videoPath: string
  onUpdate: (patch: { duration?: number }) => void
}

type Properties = SegmentProperties | TrackProperties | MarkerProperties | TimelineProperties

interface Props {
  properties: Properties | null
  onClose: () => void
}

export function PropertiesPanel({ properties, onClose }: Props) {
  if (!properties) return null

  return (
    <div className="glass-card p-4 min-w-[280px] max-w-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--ctp-text)] capitalize">
          {properties.type} Properties
        </h3>
        <button
          onClick={onClose}
          aria-label="Close properties panel"
          className="btn-ghost p-1 rounded"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content based on type */}
      {properties.type === 'segment' && (
        <SegmentPropertiesContent {...properties} />
      )}
      {properties.type === 'track' && (
        <TrackPropertiesContent {...properties} />
      )}
      {properties.type === 'marker' && (
        <MarkerPropertiesContent {...properties} />
      )}
      {properties.type === 'timeline' && (
        <TimelinePropertiesContent {...properties} />
      )}
    </div>
  )
}

function SegmentPropertiesContent({ segment, trackType, onUpdate }: SegmentProperties) {
  const [localLabel, setLocalLabel] = useState(segment.text || '')

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }

  const handleTimeChange = (field: 'start' | 'end', value: string) => {
    const numValue = parseFloat(value)
    if (!isNaN(numValue) && numValue >= 0) {
      onUpdate({ [field]: numValue })
    }
  }

  // Crop segment properties
  if (trackType === 'avatar' || trackType === 'gameplay') {
    return (
      <>
        {/* Time range */}
        <div className="space-y-2">
          <label className="text-xs text-[var(--ctp-subtext)] font-medium">Time Range</label>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <span className="text-[10px] text-[var(--ctp-subtext)]">Start</span>
              <input
                type="text"
                value={segment.start.toFixed(2)}
                onChange={(e) => handleTimeChange('start', e.target.value)}
                className="glass-input w-full px-2 py-1 text-xs font-mono"
              />
            </div>
            <span className="text-[var(--ctp-subtext)]">-</span>
            <div className="flex-1">
              <span className="text-[10px] text-[var(--ctp-subtext)]">End</span>
              <input
                type="text"
                value={segment.end.toFixed(2)}
                onChange={(e) => handleTimeChange('end', e.target.value)}
                className="glass-input w-full px-2 py-1 text-xs font-mono"
              />
            </div>
          </div>
          <div className="text-xs text-[var(--ctp-subtext)] font-mono">
            Duration: {formatTime(segment.end - segment.start)}
          </div>
        </div>

        {/* Crop coordinates */}
        {segment.cropBox && (
          <div className="space-y-2">
            <label className="text-xs text-[var(--ctp-subtext)] font-medium">Crop Region</label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-[var(--ctp-subtext)]">X</span>
                <input
                  type="number"
                  value={segment.cropBox.x}
                  onChange={(e) => onUpdate({ cropBox: { ...segment.cropBox!, x: parseInt(e.target.value) || 0 } })}
                  className="glass-input w-full px-2 py-1 text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-[var(--ctp-subtext)]">Y</span>
                <input
                  type="number"
                  value={segment.cropBox.y}
                  onChange={(e) => onUpdate({ cropBox: { ...segment.cropBox!, y: parseInt(e.target.value) || 0 } })}
                  className="glass-input w-full px-2 py-1 text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-[var(--ctp-subtext)]">Width</span>
                <input
                  type="number"
                  value={segment.cropBox.w}
                  onChange={(e) => onUpdate({ cropBox: { ...segment.cropBox!, w: parseInt(e.target.value) || 0 } })}
                  className="glass-input w-full px-2 py-1 text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-[var(--ctp-subtext)]">Height</span>
                <input
                  type="number"
                  value={segment.cropBox.h}
                  onChange={(e) => onUpdate({ cropBox: { ...segment.cropBox!, h: parseInt(e.target.value) || 0 } })}
                  className="glass-input w-full px-2 py-1 text-xs"
                />
              </div>
            </div>
          </div>
        )}

        {/* Lock toggle */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--ctp-subtext)]">Locked</span>
          <button
            onClick={() => onUpdate({ locked: !segment.locked })}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              segment.locked
                ? 'bg-[var(--ctp-mauve)] text-[var(--ctp-base)]'
                : 'bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]'
            }`}
          >
            {segment.locked ? 'Locked' : 'Unlocked'}
          </button>
        </div>
      </>
    )
  }

  // Subtitle segment properties
  if (trackType === 'subtitle') {
    return (
      <>
        {/* Time range */}
        <div className="space-y-2">
          <label className="text-xs text-[var(--ctp-subtext)] font-medium">Time Range</label>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <span className="text-[10px] text-[var(--ctp-subtext)]">Start</span>
              <input
                type="text"
                value={segment.start.toFixed(2)}
                onChange={(e) => handleTimeChange('start', e.target.value)}
                className="glass-input w-full px-2 py-1 text-xs font-mono"
              />
            </div>
            <span className="text-[var(--ctp-subtext)]">-</span>
            <div className="flex-1">
              <span className="text-[10px] text-[var(--ctp-subtext)]">End</span>
              <input
                type="text"
                value={segment.end.toFixed(2)}
                onChange={(e) => handleTimeChange('end', e.target.value)}
                className="glass-input w-full px-2 py-1 text-xs font-mono"
              />
            </div>
          </div>
          <div className="text-xs text-[var(--ctp-subtext)] font-mono">
            Duration: {formatTime(segment.end - segment.start)}
          </div>
        </div>

        {/* Text content */}
        <div className="space-y-2">
          <label className="text-xs text-[var(--ctp-subtext)] font-medium">Text</label>
          <textarea
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
            onBlur={() => onUpdate({ text: localLabel })}
            className="glass-input w-full px-2 py-2 text-xs text-[var(--ctp-text)] resize-none"
            rows={3}
            placeholder="Enter subtitle text..."
          />
        </div>

        {/* Style overrides */}
        <div className="space-y-2">
          <label className="text-xs text-[var(--ctp-subtext)] font-medium">Style</label>
          <div className="flex items-center gap-2">
            <ColorPicker
              label="Color"
              value={segment.style?.color || '#ffffff'}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate({ style: { ...segment.style, color: e.target.value } })}
            />
            <ColorPicker
              label="Background"
              value={segment.style?.backgroundColor || 'transparent'}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate({ style: { ...segment.style, backgroundColor: e.target.value } })}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--ctp-subtext)]">Font Size</label>
            <input
              type="range"
              min="12"
              max="72"
              value={segment.style?.fontSize || 36}
              onChange={(e) => onUpdate({ style: { ...segment.style, fontSize: parseInt(e.target.value) } })}
              className="flex-1 h-1.5 rounded-full appearance-none bg-[var(--ctp-overlay)] accent-[var(--ctp-mauve)]"
            />
            <span className="text-xs text-[var(--ctp-subtext)] w-8">{segment.style?.fontSize || 36}px</span>
          </div>
        </div>
      </>
    )
  }

  // Generic segment properties for other track types
  return (
    <>
      <div className="space-y-2">
        <label className="text-xs text-[var(--ctp-subtext)] font-medium">Time Range</label>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <span className="text-[10px] text-[var(--ctp-subtext)]">Start</span>
            <input
              type="text"
              value={segment.start.toFixed(2)}
              onChange={(e) => handleTimeChange('start', e.target.value)}
              className="glass-input w-full px-2 py-1 text-xs font-mono"
            />
          </div>
          <span className="text-[var(--ctp-subtext)]">-</span>
          <div className="flex-1">
            <span className="text-[10px] text-[var(--ctp-subtext)]">End</span>
            <input
              type="text"
              value={segment.end.toFixed(2)}
              onChange={(e) => handleTimeChange('end', e.target.value)}
              className="glass-input w-full px-2 py-1 text-xs font-mono"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ctp-subtext)]">Locked</span>
        <button
          onClick={() => onUpdate({ locked: !segment.locked })}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            segment.locked
              ? 'bg-[var(--ctp-mauve)] text-[var(--ctp-base)]'
              : 'bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]'
          }`}
        >
          {segment.locked ? 'Locked' : 'Unlocked'}
        </button>
      </div>
    </>
  )
}

function TrackPropertiesContent({
  trackType,
  label,
  volume,
  opacity,
  visible,
  locked,
  onUpdate,
}: TrackProperties) {
  return (
    <>
      {/* Track label */}
      <div className="space-y-2">
        <label className="text-xs text-[var(--ctp-subtext)] font-medium">Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className="glass-input w-full px-2 py-1.5 text-sm"
          placeholder="Track name..."
        />
      </div>

      {/* Volume (for audio tracks) */}
      {volume !== undefined && (
        <div className="space-y-2">
          <label className="text-xs text-[var(--ctp-subtext)] font-medium">Volume</label>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" />
            </svg>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(volume * 100)}
              onChange={(e) => onUpdate({ volume: parseInt(e.target.value) / 100 })}
              className="flex-1 h-1.5 rounded-full appearance-none bg-[var(--ctp-overlay)] accent-[var(--ctp-mauve)]"
            />
            <span className="text-xs text-[var(--ctp-subtext)] w-10 text-right">{Math.round(volume * 100)}%</span>
          </div>
        </div>
      )}

      {/* Opacity (for overlay tracks) */}
      {opacity !== undefined && (
        <div className="space-y-2">
          <label className="text-xs text-[var(--ctp-subtext)] font-medium">Opacity</label>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M12 3v18m9-9h-2M5 12H3m15.364 6.364l-1.414-1.414M6.343 6.343L4.929 4.929m12.728 0l1.414 1.414M6.343 17.657l-1.414 1.414" />
            </svg>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(opacity * 100)}
              onChange={(e) => onUpdate({ opacity: parseInt(e.target.value) / 100 })}
              className="flex-1 h-1.5 rounded-full appearance-none bg-[var(--ctp-overlay)] accent-[var(--ctp-mauve)]"
            />
            <span className="text-xs text-[var(--ctp-subtext)] w-10 text-right">{Math.round(opacity * 100)}%</span>
          </div>
        </div>
      )}

      {/* Toggles */}
      <div className="space-y-2 pt-2 border-t border-[var(--ctp-overlay)]">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--ctp-subtext)]">Visible</span>
          <button
            onClick={() => onUpdate({ visible: !visible })}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              visible
                ? 'bg-[var(--ctp-green)] text-[var(--ctp-base)]'
                : 'bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]'
            }`}
          >
            {visible ? 'Visible' : 'Hidden'}
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--ctp-subtext)]">Locked</span>
          <button
            onClick={() => onUpdate({ locked: !locked })}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              locked
                ? 'bg-[var(--ctp-mauve)] text-[var(--ctp-base)]'
                : 'bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]'
            }`}
          >
            {locked ? 'Locked' : 'Unlocked'}
          </button>
        </div>
      </div>
    </>
  )
}

function MarkerPropertiesContent({ time, label, color, duration, onUpdate }: MarkerProperties) {
  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }

  const handleTimeChange = (value: string) => {
    const numValue = parseFloat(value)
    if (!isNaN(numValue) && numValue >= 0) {
      onUpdate({ time: numValue })
    }
  }

  return (
    <>
      {/* Time */}
      <div className="space-y-2">
        <label className="text-xs text-[var(--ctp-subtext)] font-medium">Time</label>
        <input
          type="text"
          value={time.toFixed(2)}
          onChange={(e) => handleTimeChange(e.target.value)}
          className="glass-input w-full px-2 py-1.5 text-sm font-mono"
        />
      </div>

      {/* Label */}
      <div className="space-y-2">
        <label className="text-xs text-[var(--ctp-subtext)] font-medium">Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className="glass-input w-full px-2 py-1.5 text-sm"
          placeholder="Marker label..."
        />
      </div>

      {/* Duration (optional) */}
      <div className="space-y-2">
        <label className="text-xs text-[var(--ctp-subtext)] font-medium">
          Duration (optional)
        </label>
        <input
          type="text"
          value={duration?.toFixed(2) || ''}
          onChange={(e) => onUpdate({ duration: parseFloat(e.target.value) || undefined })}
          className="glass-input w-full px-2 py-1.5 text-sm font-mono"
          placeholder="0.00"
        />
      </div>

      {/* Color */}
      <div className="space-y-2">
        <label className="text-xs text-[var(--ctp-subtext)] font-medium">Color</label>
        <ColorPicker
          value={color}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate({ color: e.target.value })}
        />
      </div>
    </>
  )
}

function TimelinePropertiesContent({ duration, videoPath, onUpdate }: TimelineProperties) {
  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <>
      {/* Total duration */}
      <div className="space-y-2">
        <label className="text-xs text-[var(--ctp-subtext)] font-medium">Total Duration</label>
        <div className="text-lg font-mono text-[var(--ctp-text)]">
          {formatTime(duration)}
        </div>
      </div>

      {/* Video path */}
      <div className="space-y-2">
        <label className="text-xs text-[var(--ctp-subtext)] font-medium">Source Video</label>
        <div className="text-xs text-[var(--ctp-subtext)] font-mono break-all bg-[var(--ctp-surface-1)] p-2 rounded">
          {videoPath.split('/').pop() || videoPath}
        </div>
      </div>
    </>
  )
}
