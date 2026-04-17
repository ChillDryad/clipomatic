import React, { useState, useCallback, useEffect, useRef } from 'react'
import { frameUrl, downloadSegment, renderClip } from '../api'
import { CropCanvas } from './CropCanvas'
import { ProgressBar } from './ProgressBar'
import type { Clip, CropBox, Source, Transcript } from '../types'

interface Props {
  clips: Clip[]
  source: Source
  transcript: Transcript
}

function viralityColor(score: number): string {
  if (score >= 70) return 'text-[var(--ctp-green)]'
  if (score >= 40) return 'text-[var(--ctp-yellow)]'
  return 'text-[var(--ctp-red)]'
}

function viralityClipClass(score: number): string {
  if (score >= 70) return 'liquid-clip-card liquid-clip-card-high'
  if (score >= 40) return 'liquid-clip-card liquid-clip-card-mid'
  return 'liquid-clip-card liquid-clip-card-low'
}

function viralityBadge(score: number): string {
  if (score >= 70) return 'badge-green'
  if (score >= 40) return 'badge-yellow'
  return 'badge-red'
}

function twitchTimestamp(url: string, seconds: number): string {
  try {
    const vodId = url.match(/twitch\.tv\/videos\/(\d+)/)?.[1]
    if (!vodId) return url
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    return `https://www.twitch.tv/videos/${vodId}?t=${h}h${m}m${s}s`
  } catch {
    return url
  }
}

function ClipCard({
  clip,
  idx,
  source,
  transcript,
}: {
  clip: Clip
  idx: number
  source: Source
  transcript: Transcript
}) {
  const [start, setStart] = useState(clip.start)
  const [end, setEnd] = useState(clip.end)
  const [fontName, setFontName] = useState('Arial Bold')
  const [fontColor, setFontColor] = useState('#FFFFFF')
  const [highlightColor, setHighlightColor] = useState('#FFFF00')
  const [outlineColor, setOutlineColor] = useState('#000000')
  const [outlineWidth, setOutlineWidth] = useState(2.0)
  const [shadowColor, setShadowColor] = useState('#000000')
  const [shadowDepth, setShadowDepth] = useState(1.0)
  const [shadowOpacity, setShadowOpacity] = useState(0.5)
  const [fontSize, setFontSize] = useState(22)
  const [subtitleFadeIn, setSubtitleFadeIn] = useState(100)
  const [subtitleFadeOut, setSubtitleFadeOut] = useState(100)
  const [captionStyle, setCaptionStyle] = useState("karaoke")
  const [wordsPerLine, setWordsPerLine] = useState(1)
  const [qualityPreset, setQualityPreset] = useState("standard")
  const [videoDims, setVideoDims] = useState({ w: 1920, h: 1080 })
  const [cropBoxes, setCropBoxes] = useState<{ gameplay: CropBox; avatar: CropBox }>({
    gameplay: { x: 0, y: 0, w: 1344, h: 1080 },
    avatar: { x: 1382, y: 594, w: 518, h: 464 },
  })
  const [previewSegPath, setPreviewSegPath] = useState<string | null>(null)
  const [renderProgress, setRenderProgress] = useState<{ value: number; label: string } | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const videoPath = source.videoPath
  const twitchUrl = source.twitchUrl

  // For local video: load frame dimensions once
  useEffect(() => {
    if (!videoPath) return
    const img = new Image()
    img.onload = () => setVideoDims({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = frameUrl(videoPath, start + 2)
  // only on mount / video change, not on every start change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoPath])

  // Seek the preview video when start changes
  useEffect(() => {
    if (videoRef.current) videoRef.current.currentTime = start
  }, [start])

  // The URL passed to CropCanvas as background
  const cropFrameUrl: string | null =
    videoPath ? frameUrl(videoPath, start + 2)
    : previewSegPath ? frameUrl(previewSegPath, 2)
    : null

  const handleCropChange = useCallback((gameplay: CropBox, avatar: CropBox) => {
    setCropBoxes({ gameplay, avatar })
  }, [])

  const handleLoadPreview = async () => {
    if (!twitchUrl) return
    setError(null)
    setRenderProgress({ value: 0, label: 'Downloading 15s preview segment…' })
    try {
      const segPath = await downloadSegment(
        twitchUrl,
        Math.max(0, start),
        start + 15,
        (value, label) => setRenderProgress({ value, label }),
      )
      setPreviewSegPath(segPath)
      setRenderProgress(null)
      // Get dims from the segment frame
      const img = new Image()
      img.onload = () => setVideoDims({ w: img.naturalWidth, h: img.naturalHeight })
      img.src = frameUrl(segPath, 2)
    } catch (err) {
      setRenderProgress(null)
      setError(String(err))
    }
  }

  const handleRender = async () => {
    setError(null)
    setDownloadUrl(null)
    setRenderProgress({ value: 0, label: 'Starting render…' })

    try {
      if (twitchUrl) {
        const segPath = await downloadSegment(
          twitchUrl, start, end,
          (value, label) => setRenderProgress({ value: value * 0.4, label }),
        )
        const duration = end - start
        const offsetSegs = transcript.segments
          .filter((s) => s.end > start && s.start < end)
          .map((s) => ({
            ...s,
            start: s.start - start,
            end: s.end - start,
            words: s.words.map((w) => ({ ...w, start: w.start - start, end: w.end - start })),
          }))
        const outUrl = await renderClip(
          {
            video_path: segPath,
            clip: { ...clip, start: 0, end: duration },
            crop_avatar: cropBoxes.avatar,
            crop_game: cropBoxes.gameplay,
            segments: offsetSegs,
            font_name: fontName,
            font_color: fontColor,
            highlight_color: highlightColor,
            outline_color: outlineColor,
            outline_width: outlineWidth,
            shadow_color: shadowColor,
            shadow_depth: shadowDepth,
            shadow_opacity: shadowOpacity,
            font_size: fontSize,
            subtitle_fade_in_ms: subtitleFadeIn,
            subtitle_fade_out_ms: subtitleFadeOut,
            caption_style: captionStyle,
            words_per_line: wordsPerLine,
            quality_preset: qualityPreset,
          },
          (value, label) => setRenderProgress({ value: 0.4 + value * 0.6, label }),
        )
        setRenderProgress(null)
        setDownloadUrl(outUrl)
      } else if (videoPath) {
        const outUrl = await renderClip(
          {
            video_path: videoPath,
            clip: { ...clip, start, end },
            crop_avatar: cropBoxes.avatar,
            crop_game: cropBoxes.gameplay,
            segments: transcript.segments,
            font_name: fontName,
            font_color: fontColor,
            highlight_color: highlightColor,
            outline_color: outlineColor,
            outline_width: outlineWidth,
            shadow_color: shadowColor,
            shadow_depth: shadowDepth,
            shadow_opacity: shadowOpacity,
            font_size: fontSize,
            subtitle_fade_in_ms: subtitleFadeIn,
            subtitle_fade_out_ms: subtitleFadeOut,
            caption_style: captionStyle,
            words_per_line: wordsPerLine,
            quality_preset: qualityPreset,
          },
          (value, label) => setRenderProgress({ value, label }),
        )
        setRenderProgress(null)
        setDownloadUrl(outUrl)
      }
    } catch (err) {
      setRenderProgress(null)
      setError(String(err))
    }
  }

  return (
    <div className={`${viralityClipClass(clip.virality_score)} space-y-4 relative`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[var(--ctp-text)] font-semibold text-base leading-tight">{idx + 1}. {clip.title}</h3>
        <span className={`text-sm font-bold shrink-0 glowing-number ${viralityColor(clip.virality_score)}`} style={{'--glow-color': clip.virality_score >= 70 ? 'var(--ctp-green)' : clip.virality_score >= 40 ? 'var(--ctp-yellow)' : 'var(--ctp-red)'} as React.CSSProperties}>
          {clip.virality_score}/100
        </span>
      </div>

      <p className="text-sm text-[var(--ctp-subtext)] italic">{clip.reason}</p>

      <div className="flex flex-wrap gap-2 text-xs">
        {clip.brand_alignment.length > 0
          ? clip.brand_alignment.map((b) => (
              <span key={b} className="badge-mauve">{b}</span>
            ))
          : <span className="text-[var(--ctp-subtext)] italic">no brand — pure viral moment</span>}
        {clip.hashtags.map((h) => (
          <span key={h} className="text-[var(--ctp-subtext)]">{h}</span>
        ))}
      </div>

      {twitchUrl && (
        <div className="bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded p-2 space-y-1">
          <p className="text-xs text-[var(--ctp-subtext)]">Soft clip:</p>
          <a href={twitchTimestamp(twitchUrl, start)} target="_blank" rel="noreferrer"
            className="text-xs text-[var(--ctp-blue)] hover:opacity-80 break-all">
            {twitchTimestamp(twitchUrl, start)}
          </a>
        </div>
      )}

      {/* Time controls */}
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-[var(--ctp-subtext)]">Start (s)</span>
          <input type="number" value={start} step={0.5} min={0}
            onChange={(e) => setStart(Number(e.target.value))} className="input-field" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[var(--ctp-subtext)]">End (s)</span>
          <input type="number" value={end} step={0.5} min={0}
            onChange={(e) => setEnd(Number(e.target.value))} className="input-field" />
        </label>
      </div>
      {(end - start < 9 || end - start > 90) && (
        <p className="text-xs text-[var(--ctp-yellow)]">
          Duration is {(end - start).toFixed(1)}s — target is 9–90 seconds.
        </p>
      )}

      {/* ── Two-column: preview left | crop canvas right ── */}
      <div className="grid grid-cols-[auto_1fr] gap-4 items-start">

        {/* Left: video / frame preview */}
        <div className="w-48 shrink-0 space-y-2">
          <p className="text-xs font-medium text-[var(--ctp-subtext)]">Preview</p>
          {videoPath ? (
            <video
              ref={videoRef}
              src={videoPath}
              className="w-full rounded border border-[var(--ctp-overlay)]"
              controls
              muted
            />
          ) : (
            <div className="w-full aspect-video bg-[var(--ctp-surface)] rounded border border-[var(--ctp-overlay)] flex items-center justify-center">
              {cropFrameUrl
                ? <img src={cropFrameUrl} alt="preview" className="w-full rounded" />
                : <span className="text-xs text-[var(--ctp-subtext)] text-center px-2">Load preview to see frame</span>
              }
            </div>
          )}
          {twitchUrl && !previewSegPath && (
            <button onClick={handleLoadPreview} disabled={!!renderProgress}
              className="w-full btn-secondary text-xs py-1.5">
              Load Preview Frame
            </button>
          )}
        </div>

        {/* Right: crop canvas */}
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium text-[var(--ctp-subtext)]">Adjust crop areas</p>
          <CropCanvas
            frameUrl={cropFrameUrl}
            videoDimensions={videoDims}
            onChange={handleCropChange}
          />
        </div>
      </div>

      {/* Subtitle styling */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">Subtitle Style</p>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 liquid-chip">
            <span className="text-xs text-[var(--ctp-subtext)]">Font name</span>
            <input type="text" value={fontName} onChange={(e) => setFontName(e.target.value)} className="liquid-input input-field" />
          </label>
          <label className="space-y-1 liquid-chip">
            <span className="text-xs text-[var(--ctp-subtext)]">Font size</span>
            <input type="number" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} min={12} max={48} className="liquid-input input-field" />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 liquid-chip">
            <span className="text-xs text-[var(--ctp-subtext)]">Inactive text color</span>
            <div className="flex gap-2 items-center">
              <input type="color" value={fontColor} onChange={(e) => setFontColor(e.target.value)} />
              <span className="text-xs text-[var(--ctp-subtext)] font-mono">{fontColor}</span>
            </div>
          </label>
          <label className="space-y-1 liquid-chip">
            <span className="text-xs text-[var(--ctp-subtext)]">Active/karaoke color</span>
            <div className="flex gap-2 items-center">
              <input type="color" value={highlightColor} onChange={(e) => setHighlightColor(e.target.value)} />
              <span className="text-xs text-[var(--ctp-subtext)] font-mono">{highlightColor}</span>
            </div>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 liquid-chip">
            <span className="text-xs text-[var(--ctp-subtext)]">Outline color</span>
            <div className="flex gap-2 items-center">
              <input type="color" value={outlineColor} onChange={(e) => setOutlineColor(e.target.value)} />
              <span className="text-xs text-[var(--ctp-subtext)] font-mono">{outlineColor}</span>
            </div>
          </label>
          <label className="space-y-1 liquid-chip">
            <span className="text-xs text-[var(--ctp-subtext)]">Outline width</span>
            <input type="range" value={outlineWidth} onChange={(e) => setOutlineWidth(Number(e.target.value))} min={0} max={5} step={0.1} className="w-full" />
            <span className="text-xs text-[var(--ctp-subtext)] font-mono">{outlineWidth}px</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 liquid-chip">
            <span className="text-xs text-[var(--ctp-subtext)]">Shadow color</span>
            <div className="flex gap-2 items-center">
              <input type="color" value={shadowColor} onChange={(e) => setShadowColor(e.target.value)} />
              <span className="text-xs text-[var(--ctp-subtext)] font-mono">{shadowColor}</span>
            </div>
          </label>
          <label className="space-y-1 liquid-chip">
            <span className="text-xs text-[var(--ctp-subtext)]">Shadow depth</span>
            <input type="range" value={shadowDepth} onChange={(e) => setShadowDepth(Number(e.target.value))} min={0} max={5} step={0.1} className="w-full" />
            <span className="text-xs text-[var(--ctp-subtext)] font-mono">{shadowDepth}px</span>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <label className="space-y-1 liquid-chip">
            <span className="text-xs text-[var(--ctp-subtext)]">Shadow opacity</span>
            <input type="range" value={shadowOpacity} onChange={(e) => setShadowOpacity(Number(e.target.value))} min={0} max={1} step={0.05} className="w-full" />
            <span className="text-xs text-[var(--ctp-subtext)] font-mono">{shadowOpacity}</span>
          </label>
        </div>

        {/* Subtitle fade animation controls */}
        <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest pt-2 border-t border-[var(--ctp-overlay)]">Fade Animation</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 liquid-chip">
            <span className="text-xs text-[var(--ctp-subtext)]">Word fade in (ms)</span>
            <input type="number" value={subtitleFadeIn} onChange={(e) => setSubtitleFadeIn(Number(e.target.value))} min={0} max={500} step={10} className="liquid-input input-field" />
          </label>
          <label className="space-y-1 liquid-chip">
            <span className="text-xs text-[var(--ctp-subtext)]">Word fade out (ms)</span>
            <input type="number" value={subtitleFadeOut} onChange={(e) => setSubtitleFadeOut(Number(e.target.value))} min={0} max={500} step={10} className="liquid-input input-field" />
          </label>
        </div>

        {/* Caption style toggle */}
        <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest pt-2 border-t border-[var(--ctp-overlay)]">Caption Style</p>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name={`caption-style-${idx}`} value="karaoke" checked={captionStyle === "karaoke"} onChange={() => setCaptionStyle("karaoke")} className="accent-[var(--ctp-mauve)]" />
            <span className="text-xs text-[var(--ctp-text)]">Karaoke (sweep)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name={`caption-style-${idx}`} value="capcut" checked={captionStyle === "capcut"} onChange={() => setCaptionStyle("capcut")} className="accent-[var(--ctp-mauve)]" />
            <span className="text-xs text-[var(--ctp-text)]">CapCut (uniform)</span>
          </label>
        </div>

        {/* Words per line */}
        <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest pt-2 border-t border-[var(--ctp-overlay)]">Words Per Line</p>
        <div className="space-y-2">
          <div className="flex items-center gap-4">
            <input type="range" value={wordsPerLine} onChange={(e) => setWordsPerLine(Number(e.target.value))} min={1} max={4} step={1} className="w-full" />
            <span className="text-xs text-[var(--ctp-text)] font-mono w-8">{wordsPerLine}</span>
          </div>
          <p className="text-xs text-[var(--ctp-subtext)]">
            {wordsPerLine === 1 ? 'One word at a time (word-by-word karaoke)' : `${wordsPerLine} words per line (traditional subtitle style)`}
          </p>
        </div>

        {/* Quality preset */}
        <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest pt-2 border-t border-[var(--ctp-overlay)]">Quality Preset</p>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name={`quality-${idx}`} value="standard" checked={qualityPreset === "standard"} onChange={() => setQualityPreset("standard")} className="accent-[var(--ctp-mauve)]" />
            <div>
              <span className="text-xs text-[var(--ctp-text)] block">Standard</span>
              <span className="text-[10px] text-[var(--ctp-subtext)]">Faster encode, CRF 18</span>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name={`quality-${idx}`} value="production" checked={qualityPreset === "production"} onChange={() => setQualityPreset("production")} className="accent-[var(--ctp-mauve)]" />
            <div>
              <span className="text-xs text-[var(--ctp-text)] block">Production</span>
              <span className="text-[10px] text-[var(--ctp-subtext)]">Near-lossless, CRF 12</span>
            </div>
          </label>
        </div>
      </div>

      {renderProgress && <ProgressBar progress={renderProgress.value} label={renderProgress.label} />}

      {error && (
        <div className="bg-[var(--ctp-red-10)] border border-[var(--ctp-red-30)] rounded p-3">
          <p className="text-xs text-[var(--ctp-red)] font-mono whitespace-pre-wrap">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={handleRender} disabled={!!renderProgress} className="liquid-pill-btn btn-primary px-6 py-2">
          {renderProgress ? 'Rendering…' : 'Render Clip'}
        </button>
        {downloadUrl && (
          <a href={downloadUrl} download className="btn-secondary">Download MP4</a>
        )}
      </div>
    </div>
  )
}

export function StepReview({ clips, source, transcript }: Props) {
  const sorted = [...clips].sort((a, b) => b.virality_score - a.virality_score)
  return (
    <section>
      <h2 className="section-title">
        Step 4 — Review &amp; Render
        <span className="ml-2 text-sm font-normal text-[var(--ctp-subtext)]">{sorted.length} clips</span>
      </h2>
      <div className="space-y-4">
        {sorted.map((clip, i) => (
          <ClipCard key={i} clip={clip} idx={i} source={source} transcript={transcript} />
        ))}
      </div>
    </section>
  )
}
