import { useEffect, useCallback, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { loadTimelineDataByProject, updateClipMetadata, regenerateClipMetadata, renderClip, createMarker, listMarkers, updateMarker as updateMarkerApi, deleteMarker as deleteMarkerApi, uploadMedia, listMedia, uploadAudio, downloadSegment, getAbortController, cancelOperation, getCachedTranscript, type MediaAsset as ApiMediaAsset } from '../api'
import { OpenCutTimeline } from '../components/timeline/OpenCutTimeline'
import { TimelineToolbar } from '../components/timeline/TimelineToolbar'
import { PreviewPlayer } from '../components/timeline/PreviewPlayer'
import { PreviewViewport } from '../components/preview/PreviewViewport'
import { SubtitleEditor } from '../components/timeline/SubtitleEditor'
import { WaveformCanvas } from '../components/timeline/WaveformCanvas'
import { KeyboardShortcutsModal, useKeyboardShortcutsHelp } from '../components/panels/KeyboardShortcutsModal'
import { MarkerList } from '../components/panels/MarkerList'
import { PropertiesPanel as EditorPropertiesPanel } from '../components/properties/PropertiesPanel'
import { MediaLibrary } from '../components/panels/MediaLibrary'
import { EditorLayout } from '../components/layout/EditorLayout'
import type { TrackSegment, CropBox, Transcript, EditorNavigationState, Marker } from '../types'
import { useTimelineStore, usePlaybackStore, useSelectionStore, buildSubtitleSegments } from '../stores'

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac', '.opus'])
function isAudioFile(path: string): boolean {
  return AUDIO_EXTS.has(path.slice(path.lastIndexOf('.')).toLowerCase())
}

export function TimelineEditorPage() {
  const { projectId, clipId } = useParams<{ projectId: string; clipId: string }>()
  const searchParams = new URLSearchParams(window.location.search)
  const twitchUrl = searchParams.get('twitchUrl') ?? null
  const sourceUrl = searchParams.get('sourceUrl') ?? null
  const clipDataParam = searchParams.get('clipData')
  const navigate = useNavigate()

  // Keyboard shortcuts modal
  const { open: shortcutsOpen, onClose: closeShortcuts } = useKeyboardShortcutsHelp()

  // Local UI state (not part of timeline state)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [renderProgress, setRenderProgress] = useState<{ p: number; l: string } | null>(null)
  const [isCancellingRender, setIsCancellingRender] = useState(false)
  const [renderSettings, setRenderSettings] = useState({
    fontSize: 50,
    wordsPerLine: 2,
    qualityPreset: 'standard' as 'standard' | 'production',
    captionStyle: 'karaoke' as 'karaoke' | 'capcut',
  })
  const [segmentDownloadProgress, setSegmentDownloadProgress] = useState<{ p: number; l: string } | null>(null)

  // Panel visibility state
  const [showMarkerPanel, setShowMarkerPanel] = useState(false)
  const [showPropertiesPanel, setShowPropertiesPanel] = useState(false)
  const [showMediaLibrary, setShowMediaLibrary] = useState(false)

  // Zustand stores - use direct selectors for proper typing
  const tracks = useTimelineStore(state => state.tracks)
  const duration = useTimelineStore(state => state.duration)
  const videoPath = useTimelineStore(state => state.videoPath)
  const videoDimensions = useTimelineStore(state => state.videoDimensions)
  const clip = useTimelineStore(state => state.clip)
  const pushUndo = useTimelineStore(state => state.pushUndo)
  const undo = useTimelineStore(state => state.undo)
  const redo = useTimelineStore(state => state.redo)
  const updateSegment = useTimelineStore(state => state.updateSegment)
  const deleteSegment = useTimelineStore(state => state.deleteSegment)
  const updateCropBox = useTimelineStore(state => state.updateCropBox)
  const updateTrack = useTimelineStore(state => state.updateTrack)
  const addSegment = useTimelineStore(state => state.addSegment)
  const canUndo = useTimelineStore(state => state.canUndo)
  const canRedo = useTimelineStore(state => state.canRedo)

  const currentTime = usePlaybackStore(state => state.currentTime)
  const isPlaying = usePlaybackStore(state => state.isPlaying)
  const pxPerSecond = usePlaybackStore(state => state.zoom)
  const seek = usePlaybackStore(state => state.seek)
  const togglePlay = usePlaybackStore(state => state.togglePlay)
  const stepForward = usePlaybackStore(state => state.stepForward)
  const stepBackward = usePlaybackStore(state => state.stepBackward)
  const setZoom = usePlaybackStore(state => state.setZoom)

  const selectedSegmentIds = useSelectionStore(state => state.selectedSegmentIds)
  const select = useSelectionStore(state => state.select)
  const clearSelection = useSelectionStore(state => state.clearSelection)

  const markers = useTimelineStore(state => state.markers)
  const addMarker = useTimelineStore(state => state.addMarker)
  const deleteMarker = useTimelineStore(state => state.deleteMarker)
  const updateMarker = useTimelineStore(state => state.updateMarker)

  const transcriptRef = useRef<Transcript | null>(null)
  const animationRef = useRef<number | null>(null)

  // Get selected segment (single selection for now)
  const selectedSegmentId = selectedSegmentIds.size > 0 ? Array.from(selectedSegmentIds)[0] : null
  const selectedSegment = tracks.flatMap(t => t.segments).find(s => s.id === selectedSegmentId) ?? null
  const avatarTrack = tracks.find(t => t.type === 'avatar')
  const gameplayTrack = tracks.find(t => t.type === 'gameplay')
  const subtitleTrack = tracks.find(t => t.type === 'subtitle')
  const avatarCrop = avatarTrack?.segments[0]?.cropBox
  const gameplayCrop = gameplayTrack?.segments[0]?.cropBox

  // Load timeline data by project ID and clip ID
  useEffect(() => {
    if (!projectId || !clipId) return

    const loadTimeline = async () => {
      try {
        // Parse clip data from query params if available (from StepReview navigation)
        let clipFromParams = null
        if (clipDataParam) {
          try {
            clipFromParams = JSON.parse(clipDataParam)
          } catch (e) {
            console.error('Failed to parse clipData param:', e)
          }
        }

        // Try to load clip from API first, fall back to clipFromParams
        let clip, transcript, videoPath, videoDimensions
        try {
          const result = await loadTimelineDataByProject(projectId, clipId)
          clip = result.clip
          transcript = result.transcript
          videoPath = result.videoPath
          videoDimensions = result.videoDimensions
        } catch (err) {
          // Clip not found in DB - use clip data from params and get source from project
          if (!clipFromParams) {
            throw new Error('Clip not found and no clip data provided')
          }
          clip = clipFromParams
          // Fetch project to get source path
          const projectRes = await fetch(`/api/projects/${projectId}`, { credentials: 'include' })
          if (!projectRes.ok) throw new Error('Failed to fetch project')
          const project = await projectRes.json()
          videoPath = project.source_path
          const dimsRes = await fetch(`/api/video/dimensions?path=${encodeURIComponent(videoPath)}`, { credentials: 'include' })
          videoDimensions = dimsRes.ok ? await dimsRes.json() : { w: 1920, h: 1080 }
          // Load cached transcript
          transcript = await getCachedTranscript(videoPath)
          if (!transcript) {
            throw new Error('No cached transcript available')
          }
        }

        transcriptRef.current = transcript

        // Initialize timeline using store
        useTimelineStore.getState().initializeTimeline(clip, videoPath, videoDimensions)

        // Add subtitle segments
        const subtitleTrack = useTimelineStore.getState().tracks.find(t => t.type === 'subtitle')
        if (subtitleTrack) {
          const subtitleSegments = buildSubtitleSegments(transcript, clip.start, clip.end)
          subtitleSegments.forEach(seg => {
            useTimelineStore.getState().addSegment(subtitleTrack.id, seg)
          })
        }

        // Load markers from API
        markers.forEach(m => {
          useTimelineStore.getState().addMarker({
            id: m.id,
            time: m.time,
            label: m.label,
            color: m.color,
          })
        })

        // Auto-download clip segment with 5-second buffer on each side for editing flexibility
        const sourceUrlToUse = twitchUrl || sourceUrl
        if (sourceUrlToUse) {
          setSegmentDownloadProgress({ p: 0, l: 'Downloading clip segment for editing…' })
          try {
            const controller = getAbortController('timeline-segment')
            // Download full clip + 5 seconds at start and end for editing flexibility
            const downloadStart = Math.max(0, clip.start - 5)
            const downloadEnd = clip.end + 5
            const segPath = await downloadSegment(
              sourceUrlToUse,
              downloadStart,
              downloadEnd,
              (p, l) => setSegmentDownloadProgress({ p, l }),
              controller.signal,
            )
            // Update videoPath in timeline store to use the downloaded segment
            useTimelineStore.getState().setVideoPath(segPath)
            setSegmentDownloadProgress(null)
          } catch (err) {
            setSegmentDownloadProgress(null)
            setError(`Failed to download segment: ${err}`)
          }
        }

        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    }

    loadTimeline()
  }, [projectId, clipId, twitchUrl, sourceUrl, clipDataParam])

  // Playback animation loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
      return
    }

    let lastTime = performance.now()
    const tick = (now: number) => {
      const delta = (now - lastTime) / 1000
      lastTime = now
      seek(currentTime + delta)
      animationRef.current = requestAnimationFrame(tick)
    }
    animationRef.current = requestAnimationFrame(tick)

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
    }
  }, [isPlaying, currentTime, seek])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && e.shiftKey) {
        e.preventDefault()
        redo()
      }

      // Space for play/pause (when not typing)
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        togglePlay()
      }

      // Arrow keys for frame navigation
      if (e.code === 'ArrowLeft' && e.target === document.body) {
        e.preventDefault()
        stepBackward(1 / 30)  // 1 frame at 30fps
      }
      if (e.code === 'ArrowRight' && e.target === document.body) {
        e.preventDefault()
        stepForward(1 / 30)
      }

      // J/L for seek
      if (e.code === 'KeyJ' && e.target === document.body) {
        e.preventDefault()
        seek(currentTime - 1)
      }
      if (e.code === 'KeyL' && e.target === document.body) {
        e.preventDefault()
        seek(currentTime + 1)
      }

      // Delete selected segment
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selectedSegmentId && document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault()
          handleDeleteSegment()
        }
      }

      // M for add marker at playhead
      if (e.code === 'KeyM' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        handleAddMarker()
      }

      // S for split segment at playhead
      if (e.code === 'KeyS' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        if (canSplit) {
          handleSplit()
        }
      }

      // N for toggle snapping
      if (e.code === 'KeyN' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        // Snap toggle would go here - for now just announce
        // This would need a snapEnabled state in playback store
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [undo, redo, togglePlay, stepBackward, stepForward, seek, currentTime, selectedSegmentId])

  // Handler wrappers that push to undo stack
  const handleUpdateSegment = useCallback((trackId: string, segmentId: string, patch: Partial<TrackSegment>) => {
    pushUndo()
    updateSegment(trackId, segmentId, patch)
    setHasUnsavedChanges(true)
  }, [pushUndo, updateSegment])

  const handleDeleteSegment = useCallback(() => {
    if (!selectedSegmentId) return
    pushUndo()
    // Find the track that owns this segment
    const track = tracks.find(t => t.segments.some(s => s.id === selectedSegmentId))
    if (track) {
      deleteSegment(track.id, selectedSegmentId)
    }
    clearSelection()
    setHasUnsavedChanges(true)
  }, [selectedSegmentId, tracks, pushUndo, deleteSegment, clearSelection])

  const handleSplit = useCallback(() => {
    if (!selectedSegmentId || !duration) return
    const track = tracks.find(t => t.segments.some(s => s.id === selectedSegmentId))
    if (!track) return
    const segment = track.segments.find(s => s.id === selectedSegmentId)
    if (!segment || currentTime <= segment.start || currentTime >= segment.end) return

    const newSegment: TrackSegment = {
      id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      start: currentTime,
      end: segment.end,
      type: segment.type,
      locked: false,
      ...(segment.type === 'subtitle' ? { text: segment.text, words: segment.words } : {}),
      ...(segment.type === 'crop' ? { cropBox: segment.cropBox } : {}),
    }

    pushUndo()
    // Update original segment's end
    updateSegment(track.id, selectedSegmentId, { end: currentTime })
    // Add new segment
    addSegment(track.id, newSegment)
    setHasUnsavedChanges(true)
  }, [selectedSegmentId, tracks, currentTime, duration, pushUndo, updateSegment, addSegment])

  const handleAddSubtitle = useCallback(() => {
    const newSegment: TrackSegment = {
      id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      start: currentTime,
      end: currentTime + 2,
      type: 'subtitle',
      locked: false,
      text: '',
    }
    pushUndo()
    const subTrack = tracks.find(t => t.type === 'subtitle')
    if (subTrack) {
      addSegment(subTrack.id, newSegment)
    }
    select(newSegment.id, 'replace')
    setHasUnsavedChanges(true)
  }, [currentTime, tracks, pushUndo, addSegment, select])

  const handleAddNewSegment = useCallback((segment: TrackSegment) => {
    pushUndo()
    const subTrack = tracks.find(t => t.type === 'subtitle')
    if (subTrack) {
      addSegment(subTrack.id, segment)
    }
    select(segment.id, 'replace')
    setHasUnsavedChanges(true)
  }, [tracks, pushUndo, addSegment, select])

  const handleCropChange = useCallback((avatar: CropBox, gameplay: CropBox) => {
    pushUndo()
    updateCropBox('avatar', avatar)
    updateCropBox('gameplay', gameplay)
    setHasUnsavedChanges(true)
  }, [pushUndo, updateCropBox])

  const handleToggleVisible = useCallback((trackId: string) => {
    pushUndo()
    const track = tracks.find(t => t.id === trackId)
    if (track) {
      updateTrack(trackId, { visible: !track.visible })
    }
  }, [tracks, pushUndo, updateTrack])

  // Marker handlers - sync with API
  const handleAddMarker = useCallback(async (time?: number) => {
    const markerTime = time ?? currentTime
    try {
      const apiMarker = await createMarker({
        time: markerTime,
        label: '',
        color: '#89b4fa',
        project_id: projectId ?? undefined,
      })
      pushUndo()
      addMarker({
        id: apiMarker.id,
        time: apiMarker.time,
        label: apiMarker.label,
        color: apiMarker.color,
      })
      setHasUnsavedChanges(true)
    } catch (err) {
      console.error('Failed to create marker:', err)
    }
  }, [currentTime, pushUndo, addMarker, projectId])

  const handleDeleteMarker = useCallback(async (markerId: string) => {
    try {
      await deleteMarkerApi(markerId)
      pushUndo()
      deleteMarker(markerId)
      setHasUnsavedChanges(true)
    } catch (err) {
      console.error('Failed to delete marker:', err)
    }
  }, [pushUndo, deleteMarker])

  const handleUpdateMarker = useCallback(async (markerId: string, patch: Partial<import('../types').Marker>) => {
    try {
      await updateMarkerApi(markerId, patch)
      pushUndo()
      updateMarker(markerId, patch)
      setHasUnsavedChanges(true)
    } catch (err) {
      console.error('Failed to update marker:', err)
    }
  }, [pushUndo, updateMarker])

  // Media Library state and handlers
  const [mediaAssets, setMediaAssets] = useState<ApiMediaAsset[]>([])
  const [loadingMedia, setLoadingMedia] = useState(false)

  const loadMediaAssets = useCallback(async () => {
    setLoadingMedia(true)
    try {
      const items = await listMedia()
      setMediaAssets(items)
    } catch (err) {
      console.error('Failed to load media:', err)
    } finally {
      setLoadingMedia(false)
    }
  }, [])

  const handleUploadMedia = useCallback(async (file: File) => {
    try {
      const asset = await uploadMedia(file)
      setMediaAssets(prev => [...prev, asset])
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Upload failed')
    }
  }, [])

  // Audio upload handler
  const handleUploadAudio = useCallback(async (file: File) => {
    try {
      const result = await uploadAudio(file)
      // Add audio track at current playhead position
      pushUndo()
      const audioTrack: import('../types').Track = {
        id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
        type: 'audio',
        label: file.name,
        segments: [{
          id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
          start: 0,
          end: result.duration,
          type: 'audio',
          locked: false,
          audioUrl: result.url,
          volume: 1.0,
          fade: { in: 0, out: 0 },
        }],
        visible: true,
        locked: false,
        volume: 1.0,
        opacity: 1.0,
        collapsed: false,
      }
      useTimelineStore.getState().addTrack(audioTrack)
      setHasUnsavedChanges(true)
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Upload failed')
    }
  }, [pushUndo])

  const handleSelectMedia = useCallback((asset: import('../components/panels/MediaLibrary').MediaAsset) => {
    pushUndo()

    // Check if audio file (has duration but no video dimensions)
    const isAudio = asset.duration !== undefined && !asset.width

    if (isAudio) {
      // Add as audio track
      const audioTrack: import('../types').Track = {
        id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
        type: 'audio',
        label: asset.filename,
        segments: [{
          id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
          start: 0,
          end: asset.duration ?? 60,
          type: 'audio',
          locked: false,
          audioUrl: asset.url,
          volume: 1.0,
          fade: { in: 0, out: 0 },
        }],
        visible: true,
        locked: false,
        volume: 1.0,
        opacity: 1.0,
        collapsed: false,
      }
      useTimelineStore.getState().addTrack(audioTrack)
    } else {
      // Add as overlay track at current playhead position
      const overlayTrack: import('../types').Track = {
        id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
        type: 'overlay',
        label: asset.filename,
        segments: [{
          id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
          start: currentTime,
          end: currentTime + 5, // default 5 second duration
          type: 'overlay',
          locked: false,
          overlayUrl: asset.url,
          overlayType: asset.asset_type === 'video' ? 'video' : 'image',
          position: { x: 100, y: 100 },
          scale: 1,
          rotation: 0,
        }],
        visible: true,
        locked: false,
        volume: 1.0,
        opacity: 1.0,
        collapsed: false,
      }
      useTimelineStore.getState().addTrack(overlayTrack)
    }

    setShowMediaLibrary(false)
    setHasUnsavedChanges(true)
  }, [currentTime, pushUndo])

  const handleRegenerateMetadata = useCallback(async () => {
    if (!projectId || !clipId || !transcriptRef.current) return
    setRegenerating(true)
    try {
      const updated = await regenerateClipMetadata(clipId, clip, transcriptRef.current)
      // Update clip in timeline store
      useTimelineStore.getState().initializeTimeline(
        { ...clip, ...updated },
        videoPath,
        videoDimensions
      )
      setHasUnsavedChanges(true)
    } catch (err) {
      alert(`Failed to regenerate: ${err}`)
    } finally {
      setRegenerating(false)
    }
  }, [clip, projectId, clipId, videoPath, videoDimensions])

  const handleSave = async () => {
    if (!projectId || !clipId) return

    const avatarCrop = avatarTrack?.segments[0]?.cropBox
    const gameplayCrop = gameplayTrack?.segments[0]?.cropBox

    try {
      await updateClipMetadata(clipId, {
        start: clip.start,
        end: clip.end,
        title: clip.title,
        description: clip.description,
        crop_avatar: avatarCrop,
        crop_game: gameplayCrop,
        subtitle_segments: JSON.stringify(subtitleTrack?.segments ?? []),
      })
      navigate(`/video/${projectId}`, { state: { modifiedClip: clip } as EditorNavigationState })
    } catch (err) {
      alert(`Failed to save: ${err}`)
    }
  }

  const handleDiscard = () => {
    if (hasUnsavedChanges && !window.confirm('Discard unsaved changes?')) return
    navigate(`/video/${projectId}`)
  }

  const handleRenderCancel = useCallback(() => {
    setIsCancellingRender(true)
    cancelOperation('timeline-render')
  }, [])

  const handleRender = useCallback(({ p, l }: { p: number; l: string }) => {
    setRenderProgress({ p, l })
  }, [])

  const executeRender = useCallback(async () => {
    setRenderProgress({ p: 0, l: 'Starting render...' })
    setIsCancellingRender(false)

    const segs = subtitleTrack?.segments.map(s => ({
      start: s.start,
      end: s.end,
      text: s.text ?? '',
      words: s.words ?? [],
    })) ?? []

    const defaultAvatar: CropBox = {
      x: Math.floor(videoDimensions.w * 0.6),
      y: Math.floor(videoDimensions.h * 0.5),
      w: Math.floor(videoDimensions.w * 0.35),
      h: Math.floor(videoDimensions.h * 0.45),
    }
    const defaultGame: CropBox = { x: 0, y: 0, w: videoDimensions.w, h: videoDimensions.h }

    try {
      const controller = getAbortController('timeline-render')
      const url = await renderClip({
        video_path: videoPath,
        clip: { ...clip },
        crop_avatar: avatarCrop ?? defaultAvatar,
        crop_game: gameplayCrop ?? defaultGame,
        segments: segs,
        font_name: 'Arial',
        font_color: '#ffffff',
        highlight_color: '#ffdd00',
        outline_color: '#000000',
        outline_width: 2,
        shadow_color: '#000000',
        shadow_depth: 2,
        shadow_opacity: 0.8,
        font_size: renderSettings.fontSize,
        subtitle_fade_in_ms: 200,
        subtitle_fade_out_ms: 200,
        caption_style: renderSettings.captionStyle,
        words_per_line: renderSettings.wordsPerLine,
        quality_preset: renderSettings.qualityPreset,
      }, (p, l) => setRenderProgress({ p, l }), controller.signal)

      setRenderProgress(null)
      window.open(url, '_blank')
    } catch (err) {
      setRenderProgress(null)
      if (String(err).includes('cancelled')) {
        alert('Render cancelled')
      } else {
        alert(`Render failed: ${err}`)
      }
    } finally {
      setIsCancellingRender(false)
    }
  }, [videoPath, clip, videoDimensions, avatarCrop, gameplayCrop, subtitleTrack, renderSettings])

  const canSplit = selectedSegmentId !== null && tracks.some(t =>
    t.segments.some(s => s.id === selectedSegmentId && currentTime > s.start && currentTime < s.end)
  )

  if (loading) return <div className="text-[var(--ctp-subtext)] p-8">Loading timeline...</div>
  if (error) return <div className="text-[var(--ctp-red)] p-8">Error: {error}</div>
  if (!videoPath) return null

  // Build timeline state object for Timeline component
  const timelineState = {
    clip,
    tracks,
    duration,
    videoPath,
    videoDimensions,
  }

  return (
    <EditorLayout
      header={
        <div className="flex items-center gap-2 w-full">
          <button onClick={handleDiscard} className="btn-ghost flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back
          </button>

          <h1 className="font-semibold text-[var(--ctp-text)] truncate px-4 flex-1">
            {clip.title}
          </h1>

          <div className="flex items-center gap-2">
            {regenerating ? (
              <span className="text-xs text-[var(--ctp-subtext)] animate-pulse">Generating…</span>
            ) : (
              <button onClick={handleRegenerateMetadata} className="btn-secondary text-sm min-h-[44px]">
                Generate
              </button>
            )}
            <button onClick={handleSave} className="btn-primary flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Save & Close
            </button>
          </div>
        </div>
      }
      mediaContent={
        <MediaLibrary
          open={showMediaLibrary}
          onClose={() => setShowMediaLibrary(false)}
          onSelect={handleSelectMedia}
          assets={mediaAssets.map(a => ({
            ...a,
            original_filename: a.filename,
            asset_type: a.type === 'video' ? 'video' : 'image' as const,
          }))}
          onUpload={handleUploadMedia}
        />
      }
      previewContent={
        <div className="flex flex-col h-full">
          {avatarCrop && gameplayCrop && (
            <PreviewViewport
              videoPath={videoPath}
              currentTime={currentTime}
              videoDimensions={videoDimensions}
              avatarCrop={avatarCrop}
              gameplayCrop={gameplayCrop}
              clipStart={clip.start}
              clipEnd={clip.end}
              isPlaying={isPlaying}
              onCropChange={handleCropChange}
              onSeek={seek}
              downloadState={segmentDownloadProgress ? 'downloading' : 'done'}
              downloadProgress={segmentDownloadProgress?.p ?? 0}
              downloadLabel={segmentDownloadProgress?.l ?? ''}
            />
          )}
          {/* Toolbar */}
          <div className="flex-shrink-0 p-2">
            <TimelineToolbar
              isPlaying={isPlaying}
              canSplit={canSplit}
              canDelete={selectedSegmentId !== null}
              canUndo={canUndo}
              canRedo={canRedo}
              pxPerSecond={pxPerSecond}
              onPlayPause={togglePlay}
              onStepBack={() => stepBackward(0.5)}
              onStepForward={() => stepForward(0.5)}
              onSplit={handleSplit}
              onDelete={handleDeleteSegment}
              onAddSubtitle={handleAddSubtitle}
              onUndo={undo}
              onRedo={redo}
              setPxPerSecond={setZoom}
              renderSettings={renderSettings}
              onRenderSettingsChange={setRenderSettings}
              onRender={handleRender}
            />
          </div>
        </div>
      }
      propertiesContent={
        <EditorPropertiesPanel
          selectedSegment={selectedSegment}
          avatarCrop={avatarCrop}
          gameplayCrop={gameplayCrop}
          currentTime={currentTime}
          duration={duration}
          onUpdateSegment={(patch) => {
            if (selectedSegmentId && subtitleTrack) {
              handleUpdateSegment(subtitleTrack.id, selectedSegmentId, patch)
            }
          }}
          onCropChange={handleCropChange}
        />
      }
      timelineContent={
        <div className="h-full flex flex-col">
          {/* Segment download progress */}
          {segmentDownloadProgress && (
            <div className="p-2 border-b border-[var(--ctp-overlay)]">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--ctp-text)]">{segmentDownloadProgress.l}</span>
                <div className="flex-1 bg-[var(--ctp-surface)] rounded-full h-1.5">
                  <div
                    className="bg-[var(--ctp-mauve)] h-1.5 rounded-full transition-all"
                    style={{ width: `${segmentDownloadProgress.p}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="flex-1 overflow-hidden">
            <OpenCutTimeline
              tracks={tracks}
              duration={duration}
              currentTime={currentTime}
              onSeek={seek}
              onSelectSegment={(id, mode) => select(id ?? '', mode ?? 'replace')}
              onUpdateSegment={handleUpdateSegment}
              onDeleteSegment={(trackId, segmentId) => {
                clearSelection()
                pushUndo()
                deleteSegment(trackId, segmentId)
                setHasUnsavedChanges(true)
              }}
            />
          </div>
        </div>
      }
    />
  )
}
