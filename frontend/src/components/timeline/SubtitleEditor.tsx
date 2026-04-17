import { useRef } from 'react'
import type { TrackSegment } from '../../types'
import { parseSubtitleFile } from '../../api'

function uid(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
}

interface Props {
  segment: TrackSegment | null
  onUpdate: (patch: Partial<TrackSegment>) => void
  onDelete: () => void
  onAddNew: (segment: TrackSegment) => void
}

export function SubtitleEditor({ segment, onUpdate, onDelete, onAddNew }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImportSubtitles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const cues = await parseSubtitleFile(file)
      for (const cue of cues) {
        const newSegment: TrackSegment = {
          id: uid(),
          start: cue.startTime,
          end: cue.startTime + cue.duration,
          type: 'subtitle',
          locked: false,
          text: cue.text,
        }
        onAddNew(newSegment)
      }
    } catch (err) {
      console.error('Failed to import subtitles:', err)
    }
    e.target.value = ''
  }

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--ctp-text)]">Edit Subtitle</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-secondary text-xs"
          >
            Import Subtitles
          </button>
          <input
            type="file"
            accept=".srt,.ass,.ssa"
            ref={fileInputRef}
            onChange={handleImportSubtitles}
            className="hidden"
          />
          {segment && (
            <button onClick={onDelete} className="btn-danger text-xs">
              Delete
            </button>
          )}
        </div>
      </div>

      {segment && (
        <>
          {/* Text editing */}
          <textarea
            value={segment.text ?? ''}
            onChange={e => onUpdate({ text: e.target.value })}
            className="glass-input w-full p-2 rounded-lg text-sm text-[var(--ctp-text)] mb-3"
            rows={2}
            placeholder="Subtitle text..."
          />

          {/* Timing controls */}
          <div className="flex gap-3 items-center">
            <div className="flex items-center gap-1">
              <label className="text-xs text-[var(--ctp-subtext)]">Start</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={segment.start.toFixed(1)}
                onChange={e => onUpdate({ start: parseFloat(e.target.value) || 0 })}
                className="glass-input w-20 px-2 py-1 rounded text-sm text-[var(--ctp-text)]"
              />
            </div>

            <div className="flex items-center gap-1">
              <label className="text-xs text-[var(--ctp-subtext)]">End</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={segment.end.toFixed(1)}
                onChange={e => onUpdate({ end: parseFloat(e.target.value) || 0 })}
                className="glass-input w-20 px-2 py-1 rounded text-sm text-[var(--ctp-text)]"
              />
            </div>

            <span className="text-xs text-[var(--ctp-subtext)]">
              {formatDuration(segment.end - segment.start)}
            </span>
          </div>

          {/* Word-level display for karaoke */}
          {segment.words && segment.words.length > 0 && (
            <div className="mt-3 flex gap-1 flex-wrap">
              {segment.words.map((word, i) => (
                <span
                  key={i}
                  className="text-xs px-1.5 py-0.5 rounded bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]"
                  title={`${word.start.toFixed(2)} - ${word.end.toFixed(2)}`}
                >
                  {word.word}
                </span>
              ))}
            </div>
          )}

          {/* Style controls */}
          <div className="mt-3 flex gap-3 items-center flex-wrap">
            <div className="flex items-center gap-1">
              <label className="text-xs text-[var(--ctp-subtext)]">Font size</label>
              <input
                type="number"
                min="8"
                max="72"
                value={segment.style?.fontSize ?? 24}
                onChange={e => onUpdate({ style: { ...segment.style ?? {}, fontSize: parseInt(e.target.value) || 24 } })}
                className="glass-input w-16 px-2 py-1 rounded text-sm text-[var(--ctp-text)]"
              />
            </div>

            <div className="flex items-center gap-1">
              <label className="text-xs text-[var(--ctp-subtext)]">Color</label>
              <input
                type="color"
                value={segment.style?.color ?? '#ffffff'}
                onChange={e => onUpdate({ style: { ...segment.style ?? {}, color: e.target.value } })}
                className="w-8 h-8 rounded cursor-pointer border-0"
              />
            </div>

            <div className="flex items-center gap-1">
              <label className="text-xs text-[var(--ctp-subtext)]">BG</label>
              <input
                type="checkbox"
                checked={!!segment.style?.backgroundColor}
                onChange={e => onUpdate({ style: { ...segment.style ?? {}, backgroundColor: e.target.checked ? '#000000' : undefined } })}
                className="cursor-pointer"
              />
            </div>

            <div className="flex items-center gap-1">
              <label className="text-xs text-[var(--ctp-subtext)]">Align</label>
              <div className="flex gap-1">
                {(['left', 'center', 'right'] as const).map(align => (
                  <button
                    key={align}
                    onClick={() => onUpdate({ style: { ...segment.style ?? {}, textAlign: align } })}
                    className={`px-2 py-1 rounded text-xs ${segment.style?.textAlign === align ? 'bg-[var(--ctp-mauve)] text-[var(--ctp-base)]' : 'bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]'}`}
                  >
                    {align[0].toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(1)}s`
}