# Timeline Editor Design Spec

**Date:** 2026-04-13  
**Feature:** Timeline Editor for Momiji Clipper  
**Status:** Approved, ready for implementation

---

## Overview

Add a timeline-based video editor that allows users to tweak AI-generated clips before rendering. The editor integrates into the existing 4-step pipeline as an enhancement to StepReview.

**Key Requirements:**
- Timeline-based editing (trim, split, move, delete segments)
- Visual crop adjustments (avatar/gameplay regions)
- Subtitle editing (text, timing, add/delete segments)
- Multi-track interface (Avatar, Gameplay, Subtitle tracks)
- Ephemeral edits (client-side only, save to update clip)
- New pages: Homepage, Video Detail Page, Timeline Editor

---

## User Flow

1. User uploads video → AI detects clips
2. User lands on **Video Detail Page** showing detected clips
3. User clicks "Edit" on a clip → opens **Timeline Editor**
4. User makes adjustments in timeline editor
5. User clicks "Save & Close" → returns to Video Detail
6. User clicks "Render" from Video Detail

---

## Architecture

### New Pages

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `HomePage` | Dashboard with recent videos, stats, quick links |
| `/video/:sourcePath` | `VideoDetailPage` | Shows video info and detected clips list |
| `/video/:sourcePath/timeline/:clipIndex` | `TimelineEditorPage` | Full-page timeline editor |

### Component Structure

```
frontend/src/
├── pages/
│   ├── HomePage.tsx              # Dashboard with recent videos
│   ├── VideoDetailPage.tsx       # Video info + clips list
│   ├── TimelineEditorPage.tsx    # Main editor page
│   └── PipelinePage.tsx          # Modified: redirect to VideoDetail after highlights
├── components/
│   ├── timeline/
│   │   ├── Timeline.tsx          # Main timeline with tracks
│   │   ├── TimelineTrack.tsx     # Individual track row
│   │   ├── TimelineRuler.tsx     # Time ruler with ticks
│   │   ├── TimelineSegment.tsx   # Draggable/resizable segment
│   │   ├── Playhead.tsx          # Current time indicator
│   │   ├── PreviewPlayer.tsx     # Video preview with crop overlay
│   │   ├── SubtitleEditor.tsx    # Side panel for subtitle editing
│   │   └── TimelineToolbar.tsx   # Playback and editing controls
│   └── ... (existing components)
```

### State Management

**TimelineEditorPage state:**
```typescript
const [timelineState, setTimelineState] = useState<TimelineState | null>(null)
const [currentTime, setCurrentTime] = useState(0)
const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)
const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
const videoRef = useRef<HTMLVideoElement>(null)
```

All editing happens in React state. No context provider needed - props drill from TimelineEditorPage down to child components.

---

## Data Types

### New Types (frontend/src/types.ts)

```typescript
// Timeline state - single source of truth for editor
export interface TimelineState {
  clip: Clip                      // Original clip metadata
  tracks: Track[]                 // Avatar, Gameplay, Subtitle tracks
  duration: number                // Total clip duration in seconds
  videoPath: string
  videoDimensions: { w: number; h: number }
}

export interface Track {
  id: string
  type: 'avatar' | 'gameplay' | 'subtitle'
  label: string
  segments: TrackSegment[]
  visible: boolean
}

export interface TrackSegment {
  id: string
  start: number                   // Start time in seconds
  end: number                     // End time in seconds
  type: 'crop' | 'subtitle'
  // For crop segments:
  cropBox?: CropBox               // x, y, w, h in video pixels
  // For subtitle segments:
  text?: string
  words?: Word[]                  // Optional word-level timing for karaoke
}

// Navigation state between pages
export interface EditorNavigationState {
  modifiedClip?: Clip
  modifiedTranscript?: Transcript
}
```

---

## UI Layout

### Timeline Editor Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Video    |    {Clip Title}    |    Save & Close ✓   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                        [Preview Player]                           │
│                   (with draggable crop boxes)                   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  00:00  [Play] [<<] [>>]  |  Split  |  Delete  |  Add Subtitle  │
├─────────────────────────────────────────────────────────────────┤
│  Avatar   │  ════════════════════════════════════════════════    │
│  Gameplay │  ════════════════════════════════════════════════    │
│  Subtitles│  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░▓▓▓▓▓▓▓▓░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓    │
├─────────────────────────────────────────────────────────────────┤
│  Ruler    │  |    |    |    |    |    |    |    |    |          │
│           │  ↑ Playhead                                        │
├─────────────────────────────────────────────────────────────────┤
│  [Subtitle Editor Panel - shows when subtitle selected]         │
│  - Text input field                                             │
│  - Start time: [____] End time: [____]                        │
│  - [Delete Subtitle]  [+ Add New at Playhead]                   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Specifications

**PreviewPlayer**
- Full-width video element with current frame
- Overlay draggable crop boxes (reuses CropCanvas logic)
- Click to seek to that time
- Shows current time and total duration

**Timeline**
- Fixed zoom (entire clip visible, horizontal scroll for overflow)
- Three fixed tracks: Avatar, Gameplay, Subtitles
- Vertical stack with labels on left
- Click anywhere to move playhead

**TimelineTrack**
- Label column + segment area
- Segments as absolutely-positioned colored blocks
- Avatar: blue (`#89b4fa`), Gameplay: mauve (`#cba6f7`), Subtitles: green (`#a6e3a1`)
- Drag segment body to move in time
- Drag edges to trim start/end
- Click to select (shows selection border)

**TimelineSegment**
- Width = (duration / total_duration) * track_width
- Left position = (start / total_duration) * track_width
- Resize handles on left/right edges (2px hit area)
- Shows label if wide enough

**Playhead**
- Vertical line across all tracks
- Draggable to scrub
- Shows current time tooltip

**SubtitleEditor**
- Collapsible panel at bottom
- Only visible when subtitle segment selected
- Textarea for editing text
- Number inputs for precise timing
- Delete and Add buttons

---

## User Operations

| Action | Interaction | Result |
|--------|-------------|--------|
| **Seek** | Click timeline ruler or preview | `currentTime` updates, video seeks |
| **Play/Pause** | Spacebar or play button | Toggle `videoRef.current.play()/pause()` |
| **Step forward/back** | Arrow keys or buttons | Adjust `currentTime` by 0.5s |
| **Trim segment** | Drag segment edge | Update segment `start` or `end` |
| **Move segment** | Drag segment body | Update segment `start` and `end` equally |
| **Split segment** | Click split at playhead | Segment divides at `currentTime` |
| **Delete segment** | Select + Delete key or button | Remove from track segments array |
| **Select segment** | Click segment | `selectedSegmentId` updates |
| **Edit subtitle text** | Type in panel | Update segment `text` |
| **Adjust subtitle timing** | Edit time inputs or drag | Update segment `start`/`end` |
| **Add subtitle** | "+ Add" button | New 2s segment at `currentTime` with empty text |
| **Adjust crop** | Drag handles in preview | Update segment `cropBox` |
| **Save** | "Save & Close" button | PATCH clip API, navigate back |
| **Discard** | "← Back" with confirmation | Navigate back without saving |

---

## Data Flow

### Initialization (TimelineEditorPage mount)

```typescript
useEffect(() => {
  async function load() {
    // 1. Get clip data
    const clip = await getClip(clipKey)
    
    // 2. Get transcript
    const transcript = await getCachedTranscript(sourcePath)
    
    // 3. Get video dimensions from frame
    const dimensions = await getVideoDimensions(sourcePath)
    
    // 4. Build initial timeline state
    const initialState: TimelineState = {
      clip,
      duration: clip.end - clip.start,
      videoPath: sourcePath,
      videoDimensions: dimensions,
      tracks: [
        {
          id: 'avatar',
          type: 'avatar',
          label: 'Avatar',
          visible: true,
          segments: [{
            id: uuid(),
            start: 0,
            end: clip.end - clip.start,
            type: 'crop',
            cropBox: defaultAvatarCrop(dimensions)
          }]
        },
        {
          id: 'gameplay',
          type: 'gameplay',
          label: 'Gameplay',
          visible: true,
          segments: [{
            id: uuid(),
            start: 0,
            end: clip.end - clip.start,
            type: 'crop',
            cropBox: defaultGameplayCrop(dimensions)
          }]
        },
        {
          id: 'subtitles',
          type: 'subtitle',
          label: 'Subtitles',
          visible: true,
          segments: buildSubtitleSegments(transcript, clip.start, clip.end)
        }
      ]
    }
    
    setTimelineState(initialState)
  }
  
  load()
}, [clipKey, sourcePath])
```

### Building Subtitle Segments

```typescript
function buildSubtitleSegments(
  transcript: Transcript,
  clipStart: number,
  clipEnd: number,
  wordsPerLine: number = 2
): TrackSegment[] {
  const segments: TrackSegment[] = []
  
  // Filter words within clip bounds
  const clipWords = transcript.segments
    .flatMap(s => s.words)
    .filter(w => w.start >= clipStart && w.end <= clipEnd)
    .map(w => ({ ...w, start: w.start - clipStart, end: w.end - clipStart }))
  
  // Group words into lines
  for (let i = 0; i < clipWords.length; i += wordsPerLine) {
    const lineWords = clipWords.slice(i, i + wordsPerLine)
    if (lineWords.length === 0) continue
    
    segments.push({
      id: uuid(),
      start: lineWords[0].start,
      end: lineWords[lineWords.length - 1].end,
      type: 'subtitle',
      text: lineWords.map(w => w.word).join(' '),
      words: lineWords
    })
  }
  
  return segments
}
```

### Save Flow

```typescript
async function handleSave() {
  if (!timelineState) return
  
  // Convert tracks back to clip format
  const avatarTrack = timelineState.tracks.find(t => t.type === 'avatar')
  const gameplayTrack = timelineState.tracks.find(t => t.type === 'gameplay')
  const subtitleTrack = timelineState.tracks.find(t => t.type === 'subtitle')
  
  // Use first segment for crop boxes (timeline allows splits but rendering uses primary)
  const avatarSegment = avatarTrack?.segments[0]
  const gameplaySegment = gameplayTrack?.segments[0]
  
  // Build modified transcript from subtitle segments
  const modifiedTranscript: Transcript = {
    ...originalTranscript,
    segments: subtitleTrack?.segments.map(s => ({
      start: s.start,
      end: s.end,
      text: s.text || '',
      words: s.words || []
    })) || []
  }
  
  // Update clip metadata
  await updateClipMetadata(clipKey, {
    start: timelineState.clip.start,
    end: timelineState.clip.end,
    title: timelineState.clip.title
  })
  
  // Navigate back with state
  navigate(`/video/${encodedSourcePath}`, {
    state: { modifiedTranscript, modifiedClip: timelineState.clip }
  })
}
```

---

## API Additions

### New Functions (frontend/src/api.ts)

```typescript
// Get all clips for a source (for VideoDetailPage)
export async function getAllClips(sourcePath: string): Promise<Clip[]> {
  const clips = await getCachedClips(sourcePath)
  return clips ?? []
}

// Load complete timeline data
export interface TimelineData {
  clip: Clip
  transcript: Transcript
  videoPath: string
  videoDimensions: { w: number; h: number }
}

export async function loadTimelineData(
  clipKey: string,
  sourcePath: string
): Promise<TimelineData> {
  const [clip, transcript] = await Promise.all([
    getClip(clipKey),
    getCachedTranscript(sourcePath),
  ])
  
  if (!transcript) {
    throw new Error('Transcript not found')
  }
  
  // Get dimensions from frame
  const img = new Image()
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
    img.src = frameUrl(sourcePath, clip.start + 2)
  })
  
  return {
    clip,
    transcript,
    videoPath: sourcePath,
    videoDimensions: { w: img.naturalWidth, h: img.naturalHeight },
  }
}

// Helper to get recent videos for homepage
export async function getRecentVideos(limit: number = 10): Promise<{
  sourcePath: string
  title: string
  clipCount: number
  createdAt: number
}[]> {
  // This will scan workspace directory
  const response = await fetch(`/api/videos/recent?limit=${limit}`)
  if (!response.ok) throw new Error('Failed to fetch recent videos')
  return response.json()
}
```

### Backend Endpoint (optional - can be deferred)

If implementing homepage recent videos:

```python
@app.get("/api/videos/recent")
async def get_recent_videos(limit: int = Query(default=10, le=100)):
    """List recent videos from workspace with clip counts."""
    videos = []
    for filename in os.listdir(WORKSPACE):
        if filename.endswith(('.mp4', '.mkv', '.webm')):
            stem = os.path.splitext(filename)[0]
            transcript_path = os.path.join(WORKSPACE, f"{stem}_transcript.json")
            clips_path = os.path.join(WORKSPACE, f"{stem}_clips.json")
            
            if os.path.exists(transcript_path):
                stat = os.stat(os.path.join(WORKSPACE, filename))
                clip_count = 0
                if os.path.exists(clips_path):
                    with open(clips_path) as f:
                        clip_count = len(json.load(f))
                
                videos.append({
                    "sourcePath": os.path.join(WORKSPACE, filename),
                    "title": filename,
                    "clipCount": clip_count,
                    "createdAt": stat.st_mtime,
                })
    
    videos.sort(key=lambda v: v["createdAt"], reverse=True)
    return {"videos": videos[:limit]}
```

---

## Page Specifications

### HomePage

**Purpose:** Dashboard landing page

**Sections:**
1. **Hero:** Start new project (upload/URL input with "Start Pipeline" button)
2. **Recent Videos:** Grid of video cards showing thumbnail, title, clip count
3. **Quick Stats:** Videos processed, clips made, posts scheduled
4. **Quick Links:** Pipeline, Schedule, Platform Accounts, Settings

**Card click:** Navigate to VideoDetailPage for that video

### VideoDetailPage

**Purpose:** Video overview and clip management

**Sections:**
1. **Video Info:** Thumbnail, title, duration, transcript status, action buttons
2. **Detected Clips List:** Expandable cards showing each clip
   - Title, time range, virality score
   - "Edit in Timeline" button
   - Checkbox for batch rendering
3. **Actions:** "Render Selected", "Schedule Posts" buttons

**Data loading:**
- Parse `sourcePath` from URL (base64 decode)
- Fetch clips via `getAllClips(sourcePath)`
- Check for `navigation.state` from timeline editor for modified data

### TimelineEditorPage

**Purpose:** Full-page clip editing

**Layout:** As described in UI Layout section

**URL params:**
- `sourcePath` (base64 encoded): Path to source video
- `clipIndex`: Index in clips array

**Key behaviors:**
- Warn on unsaved changes (beforeunload event)
- Auto-save not needed (ephemeral editing)
- Video seeks when playhead moves
- Crop boxes update when avatar/gameplay segments selected

---

## Styling

Follow existing Catppuccin theme:

| Element | Color |
|---------|-------|
| Avatar track segments | `#89b4fa` (blue) |
| Gameplay track segments | `#cba6f7` (mauve) |
| Subtitle track segments | `#a6e3a1` (green) |
| Selected segment border | `#f38ba8` (pink) |
| Playhead | `#f38ba8` (pink) |
| Track backgrounds | `var(--ctp-surface)` |
| Timeline borders | `var(--ctp-overlay)` |

Segment opacity: 0.5 normally, 0.8 on hover, 1.0 when selected.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Clip not found | Show error, redirect to VideoDetail |
| Transcript not found | Show "Transcript required" message, offer to transcribe |
| Video load failure | Retry once, show fallback error |
| Save failure | Show error toast, remain in editor |
| Navigation with unsaved changes | Confirm dialog before leaving |

---

## Accessibility

- Keyboard shortcuts: Space (play/pause), Arrow keys (seek), Delete (remove selected)
- Focus states for all interactive elements
- ARIA labels for timeline tracks and segments
- Reduced motion: Disable segment animations

---

## Testing Checklist

- [ ] Load editor with valid clip/transcript
- [ ] Load editor with missing transcript (error state)
- [ ] Trim segment start/end
- [ ] Move segment to new time
- [ ] Split segment at playhead
- [ ] Delete segment
- [ ] Add new subtitle segment
- [ ] Edit subtitle text
- [ ] Adjust crop boxes
- [ ] Save and return to VideoDetail
- [ ] Discard changes with confirmation
- [ ] Homepage loads recent videos
- [ ] VideoDetail shows clips list
- [ ] Navigate from VideoDetail to Timeline

---

## Future Considerations

**Not in scope for v1:**
- Undo/redo history
- Keyboard shortcuts for all operations
- Zoom/pan on timeline
- Frame-level precision (currently seconds)
- Multiple crop keyframes over time
- Audio volume adjustments
- Export project file

---

## Approved By

User confirmed all sections on 2026-04-13.
