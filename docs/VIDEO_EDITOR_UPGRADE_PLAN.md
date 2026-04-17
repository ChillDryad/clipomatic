# Video Editor Upgrade Plan

**Goal:** Transform Momiji Clipper's clip review interface into a full-featured, OpenCut-style timeline video editor with multi-track support, advanced editing features, and server-side rendering.

**Status:** Planning Complete — Ready for Implementation

**Last Updated:** 2026-04-14

---

## Overview

This plan outlines the upgrade of the Momiji Clipper video editor to match OpenCut's functionality while maintaining server-side rendering. The upgraded editor will support:

- Multi-track timeline editing (avatar, gameplay, subtitles, overlays, audio, text)
- Advanced editing features (snapping, ripple editing, markers, multi-select)
- Zustand-based state management for better performance
- OpenCut-standard keyboard shortcuts
- Real-time preview composition
- Server-side FFmpeg rendering for all track types

---

## Phase 1: Foundation & State Management

### 1.1 Migrate to Zustand for Timeline State

**Files to create:**
- `frontend/src/stores/timelineStore.ts`
- `frontend/src/stores/playbackStore.ts`
- `frontend/src/stores/selectionStore.ts`

**Key state slices:**

```typescript
interface TimelineState {
  // Core timeline data
  tracks: Track[]
  duration: number
  videoPath: string
  videoDimensions: { w: number; h: number }
  clip: Clip
  
  // Undo/redo
  undoStack: TimelineState[]
  redoStack: TimelineState[]
  
  // Actions
  addTrack: (track: Track) => void
  removeTrack: (trackId: string) => void
  updateSegment: (trackId: string, segmentId: string, patch: Partial<TrackSegment>) => void
  undo: () => void
  redo: () => void
}

interface PlaybackState {
  currentTime: number
  isPlaying: boolean
  zoom: number  // pxPerSecond
  snapEnabled: boolean
  
  // Actions
  seek: (time: number) => void
  play: () => void
  pause: () => void
  toggleSnap: () => void
  setZoom: (zoom: number) => void
}

interface SelectionState {
  selectedSegmentIds: Set<string>
  selectedTrackIds: Set<string>
  
  // Actions
  select: (segmentId: string, mode: 'replace' | 'add' | 'range') => void
  clearSelection: () => void
  deleteSelected: () => void
  duplicateSelected: () => void
}
```

**Migration steps:**
1. Create Zustand stores with persist middleware
2. Replace `PipelineContext` timeline state with store hooks
3. Update `TimelineEditorPage` to use store selectors
4. Implement undo/redo stack within the store
5. Add localStorage persistence for session recovery

### 1.2 Expanded Track Types

**Files to modify:**
- `frontend/src/types.ts`

**New type definitions:**

```typescript
type TrackType = 'avatar' | 'gameplay' | 'subtitle' | 'overlay' | 'audio' | 'text' | 'marker'

interface Track {
  id: string
  type: TrackType
  label: string
  visible: boolean
  locked: boolean
  volume: number      // for audio tracks (0.0 - 1.0)
  opacity: number     // for overlay tracks (0.0 - 1.0)
  collapsed: boolean  // UI state for collapsed tracks
  segments: TrackSegment[]
}

interface TrackSegment {
  id: string
  start: number
  end: number
  type: SegmentType
  locked: boolean
  
  // Crop segments (avatar, gameplay)
  cropBox?: CropBox
  
  // Subtitle segments
  text?: string
  words?: Word[]
  
  // Overlay segments
  overlayUrl?: string
  overlayType?: 'image' | 'video'
  position?: { x: number; y: number }
  scale?: number
  rotation?: number
  
  // Audio segments
  audioUrl?: string
  volume?: number
  fade?: { in: number; out: number }
  
  // Text segments
  fontStyle?: {
    family: string
    size: number
    weight: 'normal' | 'bold'
    style: 'normal' | 'italic'
    color: string
    backgroundColor?: string
    textAlign: 'left' | 'center' | 'right'
  }
  
  // Animation keyframes (future)
  keyframes?: Keyframe[]
}

interface Keyframe {
  time: number
  property: string
  value: number | string
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
}

interface Marker {
  id: string
  time: number
  duration?: number
  label: string
  color: string
}
```

---

## Phase 2: Timeline Core Enhancements

### 2.1 Snapping System

**Files to create:**
- `frontend/src/utils/snapping.ts`

**Features:**
- Snap-to-playhead when dragging segments (threshold: ~5 frames / 0.16s)
- Snap-to-segment-edges (start/end of adjacent segments)
- Snap-to-markers
- Visual snap indicator (magnetic line) when snapping occurs
- Toggle with `N` key

**Implementation:**
```typescript
interface SnapPoint {
  time: number
  type: 'playhead' | 'segment-start' | 'segment-end' | 'marker'
  segmentId?: string
}

function findSnapPoints(time: number, threshold: number): SnapPoint[]
function applySnap(time: number, snapPoints: SnapPoint[]): { time: number; snapped: boolean; snapPoint?: SnapPoint }
```

### 2.2 Ripple Editing

**Files to modify:**
- `frontend/src/stores/timelineStore.ts`
- `frontend/src/components/timeline/TimelineSegment.tsx`

**Features:**
- When moving a segment, automatically shift all subsequent segments on same track
- Ripple delete: removing a segment closes the gap
- Toggle ripple mode on/off (UI toggle + shortcut)
- Visual indicator showing which segments will ripple (highlighted)

**Implementation:**
```typescript
interface RippleEdit {
  trackId: string
  movedSegmentId: string
  delta: number  // positive = gap created, negative = gap closed
  affectedSegments: { segmentId: string; originalStart: number; newStart: number }[]
}

function applyRippleEdit(state: TimelineState, edit: RippleEdit): TimelineState
```

### 2.3 Markers/Bookmarks System

**Files to create:**
- `frontend/src/components/timeline/TimelineMarkerTrack.tsx`
- `frontend/src/components/panels/MarkerList.tsx`
- `frontend/src/stores/markerStore.ts`

**Features:**
- Add marker at playhead position (`M` key)
- Marker metadata: timestamp, label, color (preset palette), duration (optional)
- Marker track displayed above timeline
- Click marker to seek
- Marker list panel for quick navigation
- Markers persist with project state
- Export markers as chapter points in rendered video

### 2.4 Multi-Selection

**Files to modify:**
- `frontend/src/stores/selectionStore.ts`
- `frontend/src/components/timeline/TimelineSegment.tsx`

**Features:**
- Shift+click to select range
- Ctrl/Cmd+click to toggle selection
- Drag selection box (lasso)
- Group operations: move, delete, duplicate selected segments
- Visual indication of multi-selection (different highlight style)

### 2.5 Improved Drag/Trim Behavior

**Files to modify:**
- `frontend/src/components/timeline/TimelineSegment.tsx`

**Features:**
- Better edge handles for trimming (44px touch targets)
- Visual feedback during drag (ghost preview / outline)
- Time display during drag operations (tooltip)
- Prevent overlapping segments (auto-trim adjacent)
- Smooth transform animations

---

## Phase 3: New Track Types

### 3.1 Overlay Track (B-roll, Memes, Reaction Images)

**Files to create:**
- `frontend/src/components/timeline/TimelineOverlayTrack.tsx`
- `frontend/src/components/panels/OverlayProperties.tsx`
- `frontend/src/components/panels/MediaLibrary.tsx`

**Backend:**
- `api.py`: `POST /api/media/upload`, `GET /api/media/list`
- `pipeline/media.py`: New module for media asset handling

**Features:**
- Support PNG/JPG uploads with transparency
- Draggable/resizable overlay segments on timeline
- Position/scale controls in properties panel
- Opacity slider
- Duration handles for fade in/out
- Blend mode selection (normal, multiply, screen, overlay)

### 3.2 Audio Track (BGM, SFX)

**Files to create:**
- `frontend/src/components/timeline/TimelineAudioTrack.tsx`
- `frontend/src/components/timeline/WaveformCanvas.tsx`
- `frontend/src/components/panels/AudioProperties.tsx`
- `frontend/src/utils/audio.ts`

**Backend:**
- `api.py`: `POST /api/audio/upload`, `GET /api/audio/waveform`
- `pipeline/audio.py`: Waveform generation, audio processing

**Features:**
- Separate audio lane below video
- Audio waveform visualization (using Web Audio API)
- Volume envelope controls
- Fade in/out handles
- Audio scrubbing preview
- Mix controls (ducking against voice audio)
- Mute/solo per track

### 3.3 Text/Annotation Track

**Files to create:**
- `frontend/src/components/timeline/TimelineTextTrack.tsx`
- `frontend/src/components/panels/TextProperties.tsx`

**Features:**
- Non-subtitle text overlays (titles, callouts, labels)
- Font, size, color, position controls
- Animation presets (slide in, pop, typewriter)
- Duration-based visibility
- Text templates (presets for common use cases)

---

## Phase 4: Preview Player Enhancements

### 4.1 Real-time Preview Composition

**Files to modify:**
- `frontend/src/components/timeline/PreviewPlayer.tsx`

**Files to create:**
- `frontend/src/components/preview/PreviewCanvas.tsx`
- `frontend/src/utils/compositing.ts`

**Features:**
- Composite all tracks in real-time:
  - Base video (gameplay + avatar crops)
  - Overlay images/videos
  - Text annotations
  - Subtitles
- Canvas-based or WebGL preview for performance
- Toggle track visibility affects preview
- Resolution preview toggle (1080x1920 vs scaled)
- Frame-accurate preview scrubbing

### 4.2 Keyboard Shortcuts (OpenCut Scheme)

**Files to modify:**
- `frontend/src/components/timeline/TimelineToolbar.tsx`
- `frontend/src/hooks/useKeyboardShortcuts.ts`

| Key | Action |
|-----|--------|
| `Space` / `K` | Play/Pause |
| `←` / `→` | Frame navigation (1/30s) |
| `J` | Seek -1 second |
| `L` | Seek +1 second |
| `M` | Add marker |
| `N` | Toggle snapping |
| `S` | Split at playhead |
| `Delete` / `Backspace` | Delete selected |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` | Redo |
| `Ctrl/Cmd+C` | Copy selected |
| `Ctrl/Cmd+V` | Paste |
| `Ctrl/Cmd+D` | Duplicate selected |
| `I` | Set in-point |
| `O` | Set out-point |
| `/` | Toggle playhead follow |

---

## Phase 5: Backend API Extensions

### 5.1 New API Endpoints

**Files to modify:**
- `api.py`
- `pipeline/renderer.py`

**New endpoints:**

```python
# Media/Overlay uploads
@app.post("/api/media/upload")
async def upload_media(file: UploadFile) -> MediaResponse

@app.get("/api/media/list")
async def list_media() -> MediaListResponse

# Audio handling
@app.post("/api/audio/upload")
async def upload_audio(file: UploadFile) -> AudioResponse

@app.get("/api/audio/waveform")
async def get_waveform(audio_path: str) -> WaveformData

# Markers
@app.post("/api/markers")
async def create_marker(req: MarkerRequest) -> Marker

@app.delete("/api/markers/{marker_id}")
async def delete_marker(marker_id: str)

@app.put("/api/markers/{marker_id}")
async def update_marker(marker_id: str, req: MarkerRequest) -> Marker

# Batch operations
@app.post("/api/timeline/batch")
async def batch_edit(req: BatchEditRequest) -> TimelineState

# Enhanced render
@app.post("/api/render/timeline")
async def render_timeline(req: TimelineRenderRequest) -> RenderResponse
```

### 5.2 Server-Side Rendering Pipeline Updates

**Files to modify:**
- `pipeline/renderer.py`
- `pipeline/audio.py` (new)

**New rendering capabilities:**

```python
def render_timeline(
    video_path: str,
    tracks: list[Track],
    markers: list[Marker],
    output_dir: str,
    # ... render settings
) -> str:
    """
    Render full timeline with all tracks:
    - Video crops (avatar + gameplay)
    - Overlay images/videos with position/scale
    - Text annotations with custom fonts
    - Subtitles with karaoke effects
    - Audio mixing (multiple tracks)
    - Marker chapters
    """
```

**FFmpeg filtergraph updates:**
- `overlay` filter for image/video overlays with position/scale
- `drawtext` filter for text annotations
- `amix` filter for audio track mixing
- `volume` filter for per-track volume control
- `afade` filter for audio fade in/out
- `metadata` injection for chapter markers

---

## Phase 6: UI Components

### 6.1 New Components

**Component inventory:**

| Component | Purpose | Priority |
|-----------|---------|----------|
| `TimelineMarkerTrack` | Marker display/addition | P1 |
| `TimelineOverlayTrack` | Overlay segment handling | P1 |
| `TimelineAudioTrack` | Audio track with waveform | P1 |
| `TimelineTextTrack` | Text annotation segments | P1 |
| `WaveformCanvas` | Audio waveform visualization | P1 |
| `PropertiesPanel` | Context-aware property editor | P1 |
| `MediaLibrary` | Overlay asset browser | P2 |
| `MarkerList` | Marker navigation panel | P1 |
| `MultiSelectBox` | Lasso selection component | P2 |
| `SnapIndicator` | Visual snap feedback | P2 |
| `RipplePreview` | Shows affected segments | P2 |
| `TrackHeader` | Reusable track controls | P1 |
| `SegmentHandles` | Trim/drag handles | P1 |
| `PlaybackControls` | Play/pause/seek toolbar | P1 |
| `ZoomSlider` | Timeline zoom control | P1 |

### 6.2 Layout Improvements

**Files to modify:**
- `frontend/src/pages/TimelineEditorPage.tsx`
- `frontend/src/components/timeline/Timeline.tsx`

**Features:**
- Resizable track heights (drag to resize)
- Collapsible track groups (click to collapse)
- Floating properties panel (drag to reposition, dock to sides)
- Split view: timeline + preview side-by-side option
- Track ordering (drag to reorder)
- Track grouping (group related tracks)

---

## Phase 7: Polish & Performance

### 7.1 Performance Optimizations

**Techniques:**
- Virtualized timeline rendering (only render visible segments)
- Debounced state updates during drag operations
- Web Worker for waveform generation
- Memoized segment components (React.memo)
- RequestAnimationFrame for smooth playback
- Lazy loading for overlay assets

**Files to create:**
- `frontend/src/workers/waveform.worker.ts`
- `frontend/src/hooks/useVirtualTimeline.ts`

### 7.2 Accessibility

**Requirements:**
- Full keyboard navigation (tab order, arrow keys)
- Screen reader labels for all interactive elements
- Focus indicators (visible outline)
- Minimum 44px touch targets
- High contrast mode support
- Keyboard shortcuts help modal (`?` key)

### 7.3 Error Handling

**Features:**
- Graceful degradation when render fails
- Auto-save timeline state to localStorage every 30s
- Recovery from crashed sessions (detect on load)
- User-friendly error messages
- Retry mechanisms for failed operations

---

## Deliverables Summary

| Phase | Deliverables | Estimated Effort |
|-------|--------------|------------------|
| 1 | Zustand stores, type definitions, migration | 3-4 days |
| 2 | Snapping, ripple editing, markers, multi-select | 4-5 days |
| 3 | Overlay, audio, text track support | 5-6 days |
| 4 | Preview composition, keyboard shortcuts | 3-4 days |
| 5 | Backend APIs, renderer updates | 4-5 days |
| 6 | UI components, layout improvements | 4-5 days |
| 7 | Performance, accessibility, error handling | 3-4 days |

**Total Estimated Effort:** 26-33 days

---

## Technical Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| State management | Zustand | Better performance, simpler API, middleware support, devtools |
| Rendering | Server-side FFmpeg | Leverages GPU, no browser limitations, consistent output |
| Preview | Canvas 2D API | Good balance of performance and complexity |
| Waveform | Web Audio API + Web Worker | Client-side generation, no server load |
| Keyboard scheme | OpenCut defaults | Industry standard, familiar to video editors |
| Audio format | WAV for processing, AAC for output | WAV for lossless editing, AAC for delivery |
| Overlay format | PNG with transparency | Standard format, browser support |

---

## Future Considerations (Not In Scope)

### Rust/WASM Renderer
**When:** Production scale, high-volume rendering
**Why:** Native performance, parallel processing, reduced server costs
**Scope:**
- Rust crate for timeline composition
- WASM bindings for preview rendering
- FFmpeg Rust bindings for encoding
- Gradual migration from Python renderer

### Real-time Collaboration
**When:** Multi-user editing workflows
**Why:** Enable collaborative editing sessions
**Scope:**
- WebSocket-based state sync
- Operational transforms for conflict resolution
- Presence indicators (who's editing what)
- Comment/annotation system

### Cloud Rendering
**When:** Scaling to many concurrent renders
**Why:** Offload CPU/GPU intensive work
**Scope:**
- Render job queue (Redis/Celery)
- Render worker autoscaling
- Progress webhooks
- CDN integration for asset delivery

### Template System
**When:** Common clip patterns identified
**Why:** Speed up repetitive editing tasks
**Scope:**
- Preset layouts (intro, outro, reaction, highlight)
- Saved crop regions per streamer
- Auto-applied subtitle styles
- One-click apply templates

### Auto-Reframe
**When:** Smart cropping needed
**Why:** AI-powered framing for different aspect ratios
**Scope:**
- Salience detection for important regions
- Face tracking for avatar crops
- Action detection for gameplay
- Smooth camera movement interpolation

### Version History
**When:** Users need to revert changes
**Why:** Safety net for editing mistakes
**Scope:**
- Snapshot timeline state on save
- Diff view between versions
- One-click restore
- Branching for experimentation

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Timeline render performance | < 16ms frame time | React DevTools profiler |
| Drag operation latency | < 50ms | Custom telemetry |
| Undo/redo latency | < 100ms | Custom telemetry |
| Preview accuracy | 100% match to render | Visual regression tests |
| Keyboard shortcut coverage | 90% of actions | Accessibility audit |
| Lighthouse accessibility score | > 90 | Lighthouse CI |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Zustand migration breaks existing features | Parallel run during transition, feature flags |
| FFmpeg filtergraph complexity | Incremental testing, reference implementations |
| Performance degradation with many tracks | Virtualization, Web Workers, profiling |
| Browser compatibility issues | Cross-browser testing, polyfills |
| Scope creep | Strict phase boundaries, MVP per phase |

---

## Appendix: OpenCut Reference

**OpenCut features we're implementing:**
- ✅ Timeline-based editing
- ✅ Multi-track support
- ✅ Real-time preview
- ✅ Snapping system
- ✅ Ripple editing
- ✅ Markers/bookmarks
- ✅ Keyboard shortcuts (Space/K, J/L, etc.)
- ✅ Multi-selection
- ✅ Zoom/scroll navigation

**OpenCut features deferred:**
- ❌ Keyframe animations (Phase 8+)
- ❌ Transitions between clips (Phase 8+)
- ❌ Effects system (blur, etc.) (Phase 8+)
- ❌ Desktop app (Tauri) (separate project)

**OpenCut GitHub:** https://github.com/OpenCut-app/OpenCut
**OpenCut Docs:** https://opencut.dev/
