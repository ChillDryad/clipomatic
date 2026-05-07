import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { downloadSegment, renderClip, updateClipMetadata, regenerateClipMetadata, generatePostDescription, transcribeSegment, getAbortController, cancelOperation, type PlatformAccount } from '../../api'
import { CropCanvas, centeredCropBox9x16 } from '../CropCanvas'
import { ProgressBar } from '../ui/ProgressBar'
import { ScheduleModal } from '../ScheduleModal'
import { PlatformAccounts } from '../PlatformAccounts'
import { usePipeline } from '../../context/PipelineContext'
import type { CropBox, Transcript, Clip } from '../../types'

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

function generatePostBody(title: string, postBody: string, hashtags: string[]): string {
  const lines = [
    title,
    '',
    postBody || 'Check out this moment from the stream!',
    ...hashtags.slice(0, 5),
  ]
  return lines.join('\n')
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
  const [fontName, setFontName] = useState('Quicksand')

  // Font options dropdown
  const FONT_OPTIONS = [
    { value: 'Quicksand', label: 'Quicksand (Default)' },
    { value: 'Arial', label: 'Arial' },
    { value: 'Arial Black', label: 'Arial Black' },
    { value: 'Impact', label: 'Impact' },
    { value: 'Comic Sans MS', label: 'Comic Sans MS' },
    { value: 'Times New Roman', label: 'Times New Roman' },
    { value: 'Courier New', label: 'Courier New' },
    { value: 'Verdana', label: 'Verdana' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Palatino Linotype', label: 'Palatino Linotype' },
  ]
  const [fontColor, setFontColor] = useState('#FFFFFF')
  const [highlightColor, setHighlightColor] = useState('#FFFFFF')
  const [outlineColor, setOutlineColor] = useState('#000000')
  const [outlineWidth, setOutlineWidth] = useState(2.0)
  const [shadowColor, setShadowColor] = useState('#000000')
  const [shadowDepth, setShadowDepth] = useState(1.0)
  const [shadowOpacity, setShadowOpacity] = useState(0.5)
  const [fontSize, setFontSize] = useState(50)
  const [subtitleFadeIn, setSubtitleFadeIn] = useState(100)
  const [subtitleFadeOut, setSubtitleFadeOut] = useState(100)
  const [captionStyle, setCaptionStyle] = useState("capcut")
  const [wordsPerLine, setWordsPerLine] = useState(1)
  const [qualityPreset, setQualityPreset] = useState("standard")
  const [layoutMode, setLayoutMode] = useState("stacked")
  const [videoDims, setVideoDims] = useState<{ w: number; h: number }>({ w: 1920, h: 1080 })
  const [cropBoxes, setCropBoxes] = useState<{ gameplay: CropBox; avatar: CropBox }>({
    gameplay: { x: 0, y: 0, w: 1344, h: 1080 },
    avatar: { x: 1382, y: 594, w: 518, h: 464 },
  })
  const [renderProgress, setRenderProgress] = useState<{ value: number; label: string } | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [improveProgress, setImproveProgress] = useState<{ value: number; label: string } | null>(null)
  const [improveModel, setImproveModel] = useState('large-v3')
  const [improvedKey, setImprovedKey] = useState<string | null>(null)
  const [isCancellingRender, setIsCancellingRender] = useState(false)
  const [postBody, setPostBody] = useState<string>('')
  const [generatingPost, setGeneratingPost] = useState(false)

  // Collapsible sections state
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    timing: true,
    preview: false,
    crops: false,
    subtitles: false,
    post: true,
    render: true,
  })

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

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

  const handleGeneratePost = async () => {
    const path = source.videoPath ?? source.audioPath ?? ''
    if (!path) return
    const clipKey = `${path}___${idx}`
    setGeneratingPost(true)
    try {
      // Use improved transcript if available for this clip window
      const improvedKey = `${path}___${start}___${end}`
      const improved = improvedSegments.get(improvedKey)
      const sourceSegments = improved
        ? { ...transcript, segments: improved.segments.filter((s: { end: number; start: number }) => s.end > start && s.start < end) }
        : transcript
      const result = await generatePostDescription(clipKey, { ...clip, start, end }, sourceSegments)
      console.log('Post description response:', result)
      console.log('Generated post body:', result.post_body)
      setPostBody(result.post_body)
    } catch (err) {
      console.error('Post generation failed:', err)
      setError(`Post generation failed: ${err}`)
    } finally {
      setGeneratingPost(false)
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

  const sourceUrl = source.twitchUrl ?? source.videoUrl ?? source.videoPath ?? source.audioPath ?? ''

  const handleImproveSubtitles = async () => {
    const path = source.videoPath ?? source.audioPath
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

  // Load video dimensions from frame endpoint on mount
  useEffect(() => {
    if (!sourceUrl) return
    const img = new Image()
    img.onload = () => setVideoDims({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = `/api/frame?video=${encodeURIComponent(sourceUrl)}&t=2`
  }, [sourceUrl])

  const handleCropChange = useCallback((gameplay: CropBox, avatar: CropBox) => {
    setCropBoxes({ gameplay, avatar })
  }, [])

  // Update crop boxes when layout mode changes
  useEffect(() => {
    if (layoutMode === "camera_only" || layoutMode === "gameplay_only") {
      const box = centeredCropBox9x16(videoDims.w, videoDims.h)
      setCropBoxes({ gameplay: box, avatar: box })
    } else {
      setCropBoxes({
        gameplay: { x: 0, y: 0, w: 1344, h: 1080 },
        avatar: { x: 1382, y: 594, w: 518, h: 464 },
      })
    }
  }, [layoutMode, videoDims.w, videoDims.h])

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
    const path = source.videoPath ?? source.audioPath
    const improvedKey = path ? `${path}___${start}___${end}` : null
    const improved = improvedKey ? improvedSegments.get(improvedKey) : null
    // Build the segment list: improved if available, otherwise fall back to original
    const sourceSegments = improved
      ? improved.segments.filter((s: { end: number; start: number }) => s.end > start && s.start < end)
      : transcript.segments

    try {
      const controller = getAbortController('render')

      // For URL sources (Twitch/YouTube), download the clip segment on-demand
      if (sourceUrl && (source.twitchUrl || source.videoUrl)) {
        setRenderProgress({ value: 0, label: 'Downloading clip segment…' })
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
        setRenderProgress({ value: 0.4, label: 'Rendering clip…' })
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
            layout_mode: layoutMode,
          },
          (value, label) => setRenderProgress({ value: 0.4 + value * 0.6, label }),
          controller.signal,
        )
        setRenderProgress(null)
        setDownloadUrl(outUrl)
      } else if (path) {
        // For file sources, offset segment timestamps to match clip's local timeline
        const offsetSegs = sourceSegments
          .map((s: { end: number; start: number; text: string; words: { start: number; end: number }[] }) => ({
            ...s,
            start: s.start - start,
            end: s.end - start,
            words: s.words?.map((w: { start: number; end: number }) => ({ ...w, start: w.start - start, end: w.end - start })) || [],
          }))
        const outUrl = await renderClip(
          {
            video_path: path,
            clip: { ...clip, start: 0, end: end - start },
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
            layout_mode: layoutMode,
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

  // Build the preview image URL — use source URL directly (no segment download needed)
  const previewFrameUrl: string | null =
    sourceUrl ? `/api/frame?video=${encodeURIComponent(sourceUrl)}&t=${(start + 2).toFixed(1)}` : null

  // CSS clip-path values for the live preview
  const avatarZoom = (() => {
    const av = cropBoxes.avatar
    const avatarScaleX = 270 / av.w
    const avatarScaleY = 135 / av.h
    return Math.max(avatarScaleX, avatarScaleY)
  })()

  // Safe video dimensions accessor
  const videoW = videoDims.w ?? 1920
  const videoH = videoDims.h ?? 1080

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

      {source.twitchUrl && (
        <div className="bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] rounded-lg p-2 space-y-1">
          <p className="text-xs text-[var(--ctp-subtext)]">Soft clip:</p>
          <a href={twitchTimestamp(source.twitchUrl, start)} target="_blank" rel="noreferrer"
            className="text-xs text-[var(--ctp-blue)] hover:opacity-80 break-all">
            {twitchTimestamp(source.twitchUrl, start)}
          </a>
        </div>
      )}

      {/* Collapsible section: Timing */}
      <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('timing')}
          className="w-full px-3 py-2 bg-[var(--ctp-surface)] flex items-center justify-between text-left hover:bg-[var(--ctp-surface-2)]"
        >
          <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">Timing</span>
          <span className="text-xs text-[var(--ctp-subtext)]">{expandedSections.timing ? '−' : '+'}</span>
        </button>
        {expandedSections.timing && (
          <div className="p-3 space-y-2">
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
          </div>
        )}
      </div>

      {/* Post Preview */}
      <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('post')}
          className="w-full px-3 py-2 bg-[var(--ctp-surface)] flex items-center justify-between text-left hover:bg-[var(--ctp-surface-2)]"
        >
          <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">Post Preview</span>
          <span className="text-xs text-[var(--ctp-subtext)]">{expandedSections.post ? '−' : '+'}</span>
        </button>
        {expandedSections.post && (
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-[var(--ctp-subtext)]">Example Post</p>
              <button
                onClick={handleGeneratePost}
                disabled={generatingPost}
                className="text-xs px-2 py-1 rounded bg-[var(--ctp-overlay)] text-[var(--ctp-text)] hover:bg-[var(--ctp-mauve)] hover:text-white disabled:opacity-50"
              >
                {generatingPost ? 'Generating…' : 'Generate'}
              </button>
            </div>
            <div className="bg-[var(--ctp-base)] border border-[var(--ctp-overlay)] rounded-lg p-3">
              <div className="text-xs text-[var(--ctp-text)] whitespace-pre-wrap font-mono bg-[var(--ctp-surface)] p-2 rounded">
                {generatePostBody(editableTitle, postBody, editableHashtags)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Improve Subtitles */}
      {(source.videoPath || source.audioPath) && (
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

      {/* Live preview — collapsible */}
      {previewFrameUrl && (
        <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('preview')}
            className="w-full px-3 py-2 bg-[var(--ctp-surface)] flex items-center justify-between text-left hover:bg-[var(--ctp-surface-2)]"
          >
            <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">Preview (9:16)</span>
            <span className="text-xs text-[var(--ctp-subtext)]">{expandedSections.preview ? '−' : '+'}</span>
          </button>
          {expandedSections.preview && (
            <div className="p-3 space-y-2">
              <div className="relative mx-auto overflow-hidden rounded-lg border-2 border-[var(--ctp-mauve)] shadow-xl" style={{ width: '100%', maxWidth: 270, aspectRatio: '9/16', background: '#181825' }}>
                {layoutMode === "camera_only" ? (
                  <div className="absolute inset-0 overflow-hidden bg-[#181825]">
                    <img src={previewFrameUrl} alt="camera preview" className="w-full h-full" style={{ objectFit: 'cover', objectPosition: `${(cropBoxes.avatar.x + cropBoxes.avatar.w / 2) / videoW * 100}% ${(cropBoxes.avatar.y + cropBoxes.avatar.h / 2) / videoH * 100}%`, transform: `scale(${avatarZoom})`, transformOrigin: `${(cropBoxes.avatar.x + cropBoxes.avatar.w / 2) / videoW * 100}% ${(cropBoxes.avatar.y + cropBoxes.avatar.h / 2) / videoH * 100}%` }} onError={(e) => { const img = e.target as HTMLImageElement; img.style.display = 'none'; img.parentElement?.style.setProperty('background', '#333') }} />
                  </div>
                ) : layoutMode === "gameplay_only" ? (
                  <div className="absolute inset-0 overflow-hidden bg-[#181825]">
                    <img src={previewFrameUrl} alt="gameplay preview" className="w-full h-full" style={{ objectFit: 'cover', objectPosition: `${(cropBoxes.gameplay.x + cropBoxes.gameplay.w / 2) / videoW * 100}% ${(cropBoxes.gameplay.y + cropBoxes.gameplay.h / 2) / videoH * 100}%` }} onError={(e) => { const img = e.target as HTMLImageElement; img.style.display = 'none'; img.parentElement?.style.setProperty('background', '#333') }} />
                  </div>
                ) : (
                  <>
                    <div className="absolute left-0 top-0 w-full h-1/2 overflow-hidden bg-[#181825]">
                      <img src={previewFrameUrl} alt="avatar preview" className="w-full h-full" style={{ objectFit: 'cover', objectPosition: `${(cropBoxes.avatar.x + cropBoxes.avatar.w / 2) / videoW * 100}% ${(cropBoxes.avatar.y + cropBoxes.avatar.h / 2) / videoH * 100}%`, transform: `scale(${avatarZoom})`, transformOrigin: `${(cropBoxes.avatar.x + cropBoxes.avatar.w / 2) / videoW * 100}% ${(cropBoxes.avatar.y + cropBoxes.avatar.h / 2) / videoH * 100}%` }} onError={(e) => { const img = e.target as HTMLImageElement; img.style.display = 'none'; img.parentElement?.style.setProperty('background', '#333') }} />
                    </div>
                    <div className="absolute left-0 bottom-0 w-full h-1/2 overflow-hidden bg-[#181825]">
                      <img src={previewFrameUrl} alt="gameplay preview" className="w-full h-full" style={{ objectFit: 'cover', objectPosition: `${(cropBoxes.gameplay.x + cropBoxes.gameplay.w / 2) / videoW * 100}% ${(cropBoxes.gameplay.y + cropBoxes.gameplay.h / 2) / videoH * 100}%` }} onError={(e) => { const img = e.target as HTMLImageElement; img.style.display = 'none'; img.parentElement?.style.setProperty('background', '#333') }} />
                    </div>
                  </>
                )}
                <div className="absolute left-0 right-0 bottom-0 flex items-center justify-center px-3 py-2 pointer-events-none" style={{ background: 'rgba(0,0,0,0.6)', height: '12%' }}>
                  <span className="text-[10px] text-white font-medium truncate">{clip.title}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Crop editor — collapsible */}
      {previewFrameUrl && (
        <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('crops')}
            className="w-full px-3 py-2 bg-[var(--ctp-surface)] flex items-center justify-between text-left hover:bg-[var(--ctp-surface-2)]"
          >
            <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">Crop Areas</span>
            <span className="text-xs text-[var(--ctp-subtext)]">{expandedSections.crops ? '−' : '+'}</span>
          </button>
          {expandedSections.crops && (
            <div className="p-3 space-y-2">
              <CropCanvas frameUrl={previewFrameUrl} videoDimensions={videoDims} onChange={handleCropChange} layoutMode={layoutMode} />
            </div>
          )}
        </div>
      )}

      {/* Subtitle styling — collapsible */}
      <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('subtitles')}
          className="w-full px-3 py-2 bg-[var(--ctp-surface)] flex items-center justify-between text-left hover:bg-[var(--ctp-surface-2)]"
        >
          <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">Subtitle Style</span>
          <span className="text-xs text-[var(--ctp-subtext)]">{expandedSections.subtitles ? '−' : '+'}</span>
        </button>
        {expandedSections.subtitles && (
          <div className="p-3 space-y-3">

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Font</span>
            <select value={fontName} onChange={(e) => setFontName(e.target.value)} className="input-field">
              {FONT_OPTIONS.map(font => (
                <option key={font.value} value={font.value}>{font.label}</option>
              ))}
            </select>
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
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name={`quality-${idx}`} value="nvenc" checked={qualityPreset === "nvenc"} onChange={() => setQualityPreset("nvenc")} className="accent-[var(--ctp-mauve)]" />
            <div>
              <span className="text-xs text-[var(--ctp-text)] block">GPU (NVENC)</span>
              <span className="text-[10px] text-[var(--ctp-subtext)]">Hardware encoding, fastest</span>
            </div>
          </label>
        </div>
          </div>
        )}
      </div>

      {/* Render Progress & Actions — collapsible */}
      <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('render')}
          className="w-full px-3 py-2 bg-[var(--ctp-surface)] flex items-center justify-between text-left hover:bg-[var(--ctp-surface-2)]"
        >
          <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">
            {renderProgress ? 'Rendering…' : downloadUrl ? 'Render Complete' : 'Render Clip'}
          </span>
          <span className="text-xs text-[var(--ctp-subtext)]">{expandedSections.render ? '−' : '+'}</span>
        </button>
        {expandedSections.render && (
          <div className="p-3 space-y-3">
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

            {/* Layout mode selector */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">Layout</p>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name={`layout-${idx}`} value="stacked" checked={layoutMode === "stacked"} onChange={() => setLayoutMode("stacked")} className="accent-[var(--ctp-mauve)]" />
                  <span className="text-xs text-[var(--ctp-text)]">Stacked</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name={`layout-${idx}`} value="camera_only" checked={layoutMode === "camera_only"} onChange={() => setLayoutMode("camera_only")} className="accent-[var(--ctp-mauve)]" />
                  <span className="text-xs text-[var(--ctp-text)]">Camera Only</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name={`layout-${idx}`} value="gameplay_only" checked={layoutMode === "gameplay_only"} onChange={() => setLayoutMode("gameplay_only")} className="accent-[var(--ctp-mauve)]" />
                  <span className="text-xs text-[var(--ctp-text)]">Game Only</span>
                </label>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleRender}
                disabled={!!renderProgress || isCancellingRender}
                className="btn-primary flex-1"
              >
                {renderProgress ? 'Rendering…' : isCancellingRender ? 'Cancelling…' : 'Render Clip'}
              </button>
              {downloadUrl && (
                <a href={downloadUrl} download className="btn-secondary">
                  <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </a>
              )}
              <button
                onClick={() => setShowAccounts(true)}
                className="btn-secondary"
              >
                Platform Accounts
              </button>
            </div>
          </div>
        )}
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
          videoPath={downloadUrl ?? source.videoPath ?? ''}
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
