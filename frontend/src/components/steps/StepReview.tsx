import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { downloadSegment, renderClip, updateClipMetadata, regenerateClipMetadata, transcribeSegment, getAbortController, cancelOperation, type PlatformAccount } from '../../api'
import { CropCanvas } from '../CropCanvas'
import { ProgressBar } from '../ui/ProgressBar'
import { ScheduleModal } from '../ScheduleModal'
import { PlatformAccounts } from '../PlatformAccounts'
import { usePipeline } from '../../context/PipelineContext'
import type { CropBox, Transcript } from '../../types'

export function StepReview() {
  const { clips, source, transcript, updateClip, improvedSegments, setImprovedSegments, projectId } = usePipeline()
  const sorted = [...(clips ?? [])].sort((a, b) => b.virality_score - a.virality_score)

  return (
    <div className="space-y-4">
      {sorted.map((clip, i) => (
        <ClipCard
          key={clip.id}
          clip={clip}
          idx={i}
          source={source!}
          transcript={transcript!}
          improvedSegments={improvedSegments}
          setImprovedSegments={setImprovedSegments}
          onUpdateClip={(patch) => updateClip(i, patch)}
          projectId={projectId}
        />
      ))}
    </div>
  )
}

function viralityColor(score: number): string {
  if (score >= 70) return 'text-[var(--ctp-green)]'
  if (score >= 40) return 'text-[var(--ctp-yellow)]'
  return 'text-[var(--ctp-red)]'
}

function viralityClipClass(score: number): string {
  if (score >= 70) return 'clip-card clip-card-high'
  if (score >= 40) return 'clip-card clip-card-mid'
  return 'clip-card clip-card-low'
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
  onUpdateClip,
  improvedSegments,
  setImprovedSegments,
  projectId,
}: {
  clip: import('../../types').Clip
  idx: number
  source: import('../../types').Source
  transcript: import('../../types').Transcript
  onUpdateClip: (patch: Partial<import('../../types').Clip>) => void
  improvedSegments: Map<string, Transcript>
  setImprovedSegments: (key: string, segments: Transcript) => void
  projectId: string | null
}) {
  const navigate = useNavigate()
  const [editableTitle, setEditableTitle] = useState(clip.title)
  const [editableHashtags, setEditableHashtags] = useState<string[]>(clip.hashtags)
  const [newTag, setNewTag] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [regenerating, setRegenerating] = useState(false)
  const [showAccounts, setShowAccounts] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)
  const [accounts, setAccounts] = useState<PlatformAccount[]>([])
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
  const [fontSize, setFontSize] = useState(50)
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
  const [improveProgress, setImproveProgress] = useState<{ value: number; label: string } | null>(null)
  const [improveModel, setImproveModel] = useState('large-v3')
  const [improvedKey, setImprovedKey] = useState<string | null>(null)
  const [isCancellingRender, setIsCancellingRender] = useState(false)

  const handleSaveMetadata = useCallback(async () => {
    setSaveState('saving')
    try {
      const sourcePath = source.videoPath ?? source.audioPath ?? ''
      const clipKey = `${sourcePath}___${idx}`
      const updated = await updateClipMetadata(clipKey, {
        title: editableTitle,
        hashtags: editableHashtags,
        start,
        end,
      })
      onUpdateClip(updated)
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2000)
    } catch {
      setSaveState('idle')
    }
  }, [editableTitle, editableHashtags, start, end, idx, onUpdateClip, source])

  const handleAddTag = () => {
    const tag = newTag.trim().startsWith('#') ? newTag.trim() : `#${newTag.trim()}`
    if (tag && !editableHashtags.includes(tag)) {
      setEditableHashtags(prev => [...prev, tag])
    }
    setNewTag('')
  }

  const handleRemoveTag = (tag: string) => {
    setEditableHashtags(prev => prev.filter(t => t !== tag))
  }

  const handleRegenerate = async () => {
    const path = source.videoPath ?? source.audioPath ?? ''
    if (!path) return
    const clipKey = `${path}___${idx}`
    setRegenerating(true)
    try {
      const updated = await regenerateClipMetadata(clipKey, clip, transcript)
      setEditableTitle(updated.title)
      if (updated.description !== undefined) {
        // description is shown in the render section if present
      }
      setEditableHashtags(updated.hashtags ?? clip.hashtags)
      onUpdateClip(updated)
    } catch (err) {
      console.error('Regenerate failed:', err)
    } finally {
      setRegenerating(false)
    }
  }

  const handleEditInTimeline = () => {
    const qs = new URLSearchParams()
    if (source.twitchUrl) qs.set('twitchUrl', source.twitchUrl)
    if (source.videoUrl) qs.set('sourceUrl', source.videoUrl)
    // Pass clip data via query params for on-demand editing
    qs.set('clipData', JSON.stringify({
      index: idx,
      title: clip.title,
      start: clip.start,
      end: clip.end,
      reason: clip.reason,
      virality_score: clip.virality_score,
      brand_alignment: clip.brand_alignment,
      hashtags: clip.hashtags,
    }))
    navigate(`/video/${projectId}/timeline/${idx}${qs.toString() ? `?${qs.toString()}` : ''}`)
  }

  const videoPath = source.videoPath
  const twitchUrl = source.twitchUrl

  const handleImproveSubtitles = async () => {
    const path = videoPath ?? source.audioPath
    if (!path) return
    setImproveProgress({ value: 0, label: 'Starting…' })
    const key = `${path}___${start}___${end}`
    try {
      const result = await transcribeSegment(
        {
          video_path: path,
          start,
          end,
          model_size: improveModel,
          device: 'auto',
        },
        (value, label) => setImproveProgress({ value, label }),
      )
      setImprovedSegments(key, result)
      setImprovedKey(key)
      setImproveProgress(null)
    } catch (err) {
      setImproveProgress(null)
      setError(`Improve failed: ${err}`)
    }
  }

  // Auto-load preview on mount for Twitch sources
  useEffect(() => {
    if (!twitchUrl) return
    const path = videoPath ?? source.audioPath ?? ''
    if (!path) return
    setError(null)
    setRenderProgress({ value: 0, label: 'Downloading 15s preview segment…' })
    const loadPreview = async () => {
      try {
        const segPath = await downloadSegment(
          twitchUrl,
          Math.max(0, start),
          start + 15,
          (value, label) => setRenderProgress({ value, label }),
        )
        setPreviewSegPath(segPath)
        setRenderProgress(null)
        const img = new Image()
        img.onload = () => setVideoDims({ w: img.naturalWidth, h: img.naturalHeight })
        img.src = `/workspace/${segPath.split('/').pop()}?t=2`
      } catch (err) {
        setRenderProgress(null)
        setError(String(err))
      }
    }
    loadPreview()
  }, [twitchUrl, videoPath, source.audioPath, start])

  const handleCropChange = useCallback((gameplay: CropBox, avatar: CropBox) => {
    setCropBoxes({ gameplay, avatar })
  }, [])

  const handleRenderCancel = () => {
    setIsCancellingRender(true)
    cancelOperation('render')
  }

  const handleRender = async () => {
    setError(null)
    setDownloadUrl(null)
    setRenderProgress({ value: 0, label: 'Starting render…' })
    setIsCancellingRender(false)

    // Use improved transcript if available for this clip window
    const path = videoPath ?? source.audioPath
    const improvedKey = path ? `${path}___${start}___${end}` : null
    const improved = improvedKey ? improvedSegments.get(improvedKey) : null
    // Build the segment list: improved if available, otherwise fall back to original
    const sourceSegments = improved
      ? improved.segments.filter((s: { end: number; start: number }) => s.end > start && s.start < end)
      : transcript.segments

    try {
      const controller = getAbortController('render')
      const sourceUrl = source.twitchUrl || source.videoUrl

      // For URL sources, download the clip segment on-demand (faster, less storage)
      if (sourceUrl) {
        const segPath = await downloadSegment(
          sourceUrl, start, end,
          (value, label) => setRenderProgress({ value: value * 0.4, label }),
          controller.signal,
        )
        const duration = end - start
        const offsetSegs = sourceSegments
          .map((s: { end: number; start: number; text: string; words: { start: number; end: number }[] }) => ({
            ...s,
            start: s.start - start,
            end: s.end - start,
            words: s.words.map((w: { start: number; end: number }) => ({ ...w, start: w.start - start, end: w.end - start })),
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
          controller.signal,
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
            segments: sourceSegments,
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
          controller.signal,
        )
        setRenderProgress(null)
        setDownloadUrl(outUrl)
      }
    } catch (err) {
      setRenderProgress(null)
      if (String(err).includes('cancelled')) {
        setError('Render cancelled')
      } else {
        setError(String(err))
      }
    } finally {
      setIsCancellingRender(false)
    }
  }

  // Build the preview image URL — use uploaded video at frame, or preview segment
  const previewFrameUrl: string | null =
    videoPath ? `/api/frame?video=${encodeURIComponent(videoPath)}&t=${(start + 2).toFixed(1)}`
    : previewSegPath ? `/api/frame?video=${encodeURIComponent(previewSegPath)}&t=2`
    : null

  // CSS clip-path values for the live preview
  const { gp, av, avatarZoom } = (() => {
    const sw = videoDims.w
    const sh = videoDims.h
    const gp = cropBoxes.gameplay
    const av = cropBoxes.avatar
    const avatarScaleX = 270 / av.w
    const avatarScaleY = 135 / av.h
    return {
      gp: `inset(${(gp.y / sh * 100).toFixed(1)}% ${((sw - gp.x - gp.w) / sw * 100).toFixed(1)}% ${((sh - gp.y - gp.h) / sh * 100).toFixed(1)}% ${(gp.x / sw * 100).toFixed(1)}%)`,
      av: `inset(${(av.y / sh * 100).toFixed(1)}% ${((sw - av.x - av.w) / sw * 100).toFixed(1)}% ${((sh - av.y - av.h) / sh * 100).toFixed(1)}% ${(av.x / sw * 100).toFixed(1)}%)`,
      avatarZoom: Math.max(avatarScaleX, avatarScaleY),
    }
  })()

  return (
    <div className={`${viralityClipClass(clip.virality_score)} space-y-4 p-5`}>
      {/* Header row — editable title */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-[var(--ctp-subtext)] font-medium">#{idx + 1}</span>
            <input
              type="text"
              value={editableTitle}
              onChange={e => setEditableTitle(e.target.value)}
              className="flex-1 bg-transparent border-b border-[var(--ctp-overlay)] focus:border-[var(--ctp-mauve)] text-[var(--ctp-text)] font-semibold text-base leading-tight outline-none"
            />
          </div>
          {/* Editable hashtags */}
          <div className="flex flex-wrap gap-1 items-center mt-1">
            {editableHashtags.map(h => (
              <span key={h} className="badge-mauve flex items-center gap-1">
                {h}
                <button onClick={() => handleRemoveTag(h)} className="hover:text-red-400 text-xs leading-none">×</button>
              </span>
            ))}
            <input
              type="text"
              value={newTag}
              placeholder="+tag"
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag() } }}
              className="bg-transparent text-xs text-[var(--ctp-subtext)] outline-none w-16 placeholder:text-[var(--ctp-overlay)]"
            />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-sm font-bold glowing-number ${viralityColor(clip.virality_score)}`} style={{'--glow-color': clip.virality_score >= 70 ? 'var(--ctp-green)' : clip.virality_score >= 40 ? 'var(--ctp-yellow)' : 'var(--ctp-red)'} as React.CSSProperties}>
            {clip.virality_score}/100
          </span>
          <button
            onClick={handleSaveMetadata}
            disabled={saveState !== 'idle'}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              saveState === 'saved'
                ? 'bg-green-700 text-green-200'
                : saveState === 'saving'
                ? 'bg-zinc-600 text-zinc-400'
                : 'bg-[var(--ctp-overlay)] text-[var(--ctp-subtext)] hover:bg-[var(--ctp-mauve)] hover:text-white'
            }`}
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save'}
          </button>
          <button
            onClick={() => setShowSchedule(true)}
            className="text-xs px-2 py-0.5 rounded bg-indigo-800 text-indigo-200 hover:bg-indigo-700"
          >
            Schedule
          </button>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="text-xs px-2 py-0.5 rounded bg-[var(--ctp-overlay)] text-[var(--ctp-subtext)] hover:bg-[var(--ctp-mauve)] hover:text-white disabled:opacity-50"
          >
            {regenerating ? '…' : 'Generate'}
          </button>
          <button
            onClick={handleEditInTimeline}
            className="text-xs px-2 py-0.5 rounded bg-[var(--ctp-blue)]/20 text-[var(--ctp-blue)] hover:bg-[var(--ctp-blue)]/40"
          >
            Edit in Timeline
          </button>
        </div>
      </div>

      <p className="text-sm text-[var(--ctp-subtext)] italic">{clip.reason}</p>

      <div className="flex flex-wrap gap-2 text-xs">
        {clip.brand_alignment.length > 0
          ? clip.brand_alignment.map((b) => (
              <span key={b} className="badge-mauve">{b}</span>
            ))
          : <span className="text-[var(--ctp-subtext)] italic">no brand — pure viral moment</span>}
      </div>

      {twitchUrl && (
        <div className="bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded-lg p-2 space-y-1">
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

      {/* Improve Subtitles */}
      {(videoPath || source.audioPath) && (
        <div className="border border-[var(--ctp-overlay)] rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">Improve Subtitles</p>
            {improvedKey && (
              <span className="text-xs text-green-400 flex items-center gap-1">
                <span>✓</span> High-quality transcript ready
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--ctp-subtext)]">
            Re-transcribe this clip with a larger model for better word-level accuracy.
          </p>
          <div className="flex items-center gap-3">
            <select
              className="bg-zinc-800 border border-[var(--ctp-overlay)] rounded px-2 py-1 text-xs text-white"
              value={improveModel}
              onChange={e => setImproveModel(e.target.value)}
            >
              <option value="medium">medium — fast, good quality</option>
              <option value="large-v3">large-v3 — best accuracy</option>
              <option value="large-v3-turbo">large-v3-turbo — balanced speed</option>
            </select>
            <button
              onClick={handleImproveSubtitles}
              disabled={!!improveProgress}
              className="text-xs px-3 py-1 rounded bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] text-[var(--ctp-text)] hover:bg-[var(--ctp-mauve)] hover:text-white disabled:opacity-50"
            >
              {improveProgress ? 'Transcribing…' : 'Transcribe Clip'}
            </button>
          </div>
          {improveProgress && (
            <ProgressBar progress={improveProgress.value} label={improveProgress.label} />
          )}
        </div>
      )}

      {/* Live preview — 9:16 output mockup (avatar top, gameplay bottom) */}
      {previewFrameUrl && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--ctp-subtext)]">Live Preview — 9:16 output</p>
          <div className="relative mx-auto overflow-hidden rounded-lg border-2 border-[var(--ctp-mauve)] shadow-xl" style={{ width: '100%', maxWidth: 270, aspectRatio: '9/16', background: '#181825' }}>
            {/* Avatar — TOP 50% of output: show cropped area scaled to fill */}
            <div className="absolute left-0 top-0 w-full h-1/2 overflow-hidden bg-[#181825]">
              <img
                src={previewFrameUrl}
                alt="avatar preview"
                className="w-full h-full"
                style={{
                  objectFit: 'cover',
                  objectPosition: `${(cropBoxes.avatar.x + cropBoxes.avatar.w / 2) / videoDims.w * 100}% ${(cropBoxes.avatar.y + cropBoxes.avatar.h / 2) / videoDims.h * 100}%`,
                  // Scale to fill: the avatar crop box should fill the entire top half (270x135)
                  transform: `scale(${avatarZoom})`,
                  transformOrigin: `${(cropBoxes.avatar.x + cropBoxes.avatar.w / 2) / videoDims.w * 100}% ${(cropBoxes.avatar.y + cropBoxes.avatar.h / 2) / videoDims.h * 100}%`,
                }}
                onError={(e) => {
                  const img = e.target as HTMLImageElement
                  img.style.display = 'none'
                  if (img.parentElement) {
                    img.parentElement.style.background = '#333'
                  }
                }}
              />
            </div>
            {/* Gameplay — BOTTOM 50% of output: show cropped area scaled to fill */}
            <div className="absolute left-0 bottom-0 w-full h-1/2 overflow-hidden bg-[#181825]">
              <img
                src={previewFrameUrl}
                alt="gameplay preview"
                className="w-full h-full"
                style={{
                  objectFit: 'cover',
                  objectPosition: `${(cropBoxes.gameplay.x + cropBoxes.gameplay.w / 2) / videoDims.w * 100}% ${(cropBoxes.gameplay.y + cropBoxes.gameplay.h / 2) / videoDims.h * 100}%`,
                }}
                onError={(e) => {
                  const img = e.target as HTMLImageElement
                  img.style.display = 'none'
                  if (img.parentElement) {
                    img.parentElement.style.background = '#333'
                  }
                }}
              />
            </div>
            {/* Subtitle bar at bottom */}
            <div
              className="absolute left-0 right-0 bottom-0 flex items-center justify-center px-3 py-2 pointer-events-none"
              style={{ background: 'rgba(0,0,0,0.6)', height: '12%' }}
            >
              <span className="text-[10px] text-white font-medium truncate">
                {clip.title}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Crop editor — full width, natural size */}
      {previewFrameUrl && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--ctp-subtext)]">Adjust Crop Areas</p>
          <CropCanvas
            frameUrl={previewFrameUrl}
            videoDimensions={videoDims}
            onChange={handleCropChange}
          />
        </div>
      )}

      {/* Subtitle styling */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest pt-2 border-t border-[var(--ctp-overlay)]">Subtitle Style</p>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Font name</span>
            <input type="text" value={fontName} onChange={(e) => setFontName(e.target.value)} className="input-field" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Font size</span>
            <input type="number" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} min={12} max={48} className="input-field" />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Inactive text color</span>
            <div className="flex gap-2 items-center">
              <input type="color" value={fontColor} onChange={(e) => setFontColor(e.target.value)} />
              <span className="text-xs text-[var(--ctp-subtext)] font-mono">{fontColor}</span>
            </div>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Active/karaoke color</span>
            <div className="flex gap-2 items-center">
              <input type="color" value={highlightColor} onChange={(e) => setHighlightColor(e.target.value)} />
              <span className="text-xs text-[var(--ctp-subtext)] font-mono">{highlightColor}</span>
            </div>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Outline color</span>
            <div className="flex gap-2 items-center">
              <input type="color" value={outlineColor} onChange={(e) => setOutlineColor(e.target.value)} />
              <span className="text-xs text-[var(--ctp-subtext)] font-mono">{outlineColor}</span>
            </div>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Outline width</span>
            <input type="range" value={outlineWidth} onChange={(e) => setOutlineWidth(Number(e.target.value))} min={0} max={5} step={0.1} className="w-full" />
            <span className="text-xs text-[var(--ctp-subtext)] font-mono">{outlineWidth}px</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Shadow color</span>
            <div className="flex gap-2 items-center">
              <input type="color" value={shadowColor} onChange={(e) => setShadowColor(e.target.value)} />
              <span className="text-xs text-[var(--ctp-subtext)] font-mono">{shadowColor}</span>
            </div>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Shadow depth</span>
            <input type="range" value={shadowDepth} onChange={(e) => setShadowDepth(Number(e.target.value))} min={0} max={5} step={0.1} className="w-full" />
            <span className="text-xs text-[var(--ctp-subtext)] font-mono">{shadowDepth}px</span>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Shadow opacity</span>
            <input type="range" value={shadowOpacity} onChange={(e) => setShadowOpacity(Number(e.target.value))} min={0} max={1} step={0.05} className="w-full" />
            <span className="text-xs text-[var(--ctp-subtext)] font-mono">{shadowOpacity}</span>
          </label>
        </div>

        <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest pt-2 border-t border-[var(--ctp-overlay)]">Fade Animation</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Word fade in (ms)</span>
            <input type="number" value={subtitleFadeIn} onChange={(e) => setSubtitleFadeIn(Number(e.target.value))} min={0} max={500} step={10} className="input-field" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Word fade out (ms)</span>
            <input type="number" value={subtitleFadeOut} onChange={(e) => setSubtitleFadeOut(Number(e.target.value))} min={0} max={500} step={10} className="input-field" />
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

      {renderProgress && (
        <div className="space-y-2">
          <ProgressBar progress={renderProgress.value} label={renderProgress.label} />
          <div className="flex justify-end">
            <button
              onClick={handleRenderCancel}
              disabled={isCancellingRender}
              className="text-xs text-[var(--ctp-red)] hover:text-[var(--ctp-red)]/80 disabled:opacity-50 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              {isCancellingRender ? 'Cancelling…' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-[var(--ctp-red-10)] border border-[var(--ctp-red-30)] rounded p-3">
          <p className="text-xs text-[var(--ctp-red)] font-mono whitespace-pre-wrap">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={handleRender} disabled={!!renderProgress || isCancellingRender} className="btn-primary">
          {renderProgress ? 'Rendering…' : isCancellingRender ? 'Cancelling…' : 'Render Clip'}
        </button>
        {downloadUrl && (
          <a href={downloadUrl} download className="btn-secondary">Download MP4</a>
        )}
        <button
          onClick={() => setShowAccounts(true)}
          className="btn-secondary"
        >
          Platform Accounts
        </button>
      </div>

      {showAccounts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md shadow-2xl border border-zinc-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Platform Accounts</h3>
              <button onClick={() => setShowAccounts(false)} className="text-zinc-400 hover:text-white">✕</button>
            </div>
            <PlatformAccounts />
          </div>
        </div>
      )}

      {showSchedule && (
        <ScheduleModal
          clip={{ ...clip, title: editableTitle, hashtags: editableHashtags }}
          clipKey={`${source.videoPath ?? source.audioPath ?? ''}___${idx}`}
          videoPath={downloadUrl ?? videoPath ?? ''}
          platformAccounts={accounts}
          onClose={() => setShowSchedule(false)}
          onScheduled={(jobId) => {
            setShowSchedule(false)
            window.location.href = `/schedule?scheduled=${jobId}`
          }}
        />
      )}
    </div>
  )
}
