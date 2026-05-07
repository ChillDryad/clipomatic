# Bug Fix Plan — Overview

All bugs found in the clip review workflow, grouped by feature area for incremental execution.

## Bug Index

| # | Bug | Area |
|---|-----|------|
| 1 | Cannot adjust timing for clips to render | Clip Timing |
| 2 | No preview player | Preview |
| 3 | Preview renders inaccurately | Preview |
| 4 | yt-dlp segment download fails (exit 1) | Rendering Pipeline |
| 5 | NVENC rendering missing from UI | Rendering Pipeline |
| 6 | Crop area preview re-renders on every update | Crop Area |
| 7 | Crop area accordion does not expand as others do | Crop Area |
| 8 | Crop area shows title bar, but not likes/comments/share | Crop Area |
| 9 | On crop area resize, render style resets | Crop Area |
| 10 | Crop area size not retained on update | Crop Area |

## Groups

| Group | Bugs | Description |
|-------|------|-------------|
| **Crop Area** | 6, 7, 8, 9, 10 | All bugs in CropCanvas + crop state in VideoProjectPage |
| **Rendering Pipeline** | 4, 5 | yt-dlp crash + NVENC missing |
| **Preview System** | 2, 3 | No player + inaccurate preview |
| **Clip Timing** | 1 | Can't adjust start/end |

---

# Group 1: Crop Area Bug Fixes

## Context

Five crop area bugs found in the clip review workflow. All touch the same component tree: `VideoProjectPage.tsx` (clip detail view) and `CropCanvas.tsx` (Konva-based crop region editor). These should be fixed together since they share state and are tightly coupled.

**Bugs covered:**
- Bug 6: Crop area preview re-renders on every update (unnecessary HTTP requests)
- Bug 7: Crop area accordion doesn't expand as others do (wrong click target)
- Bug 8: Crop area shows title bar, but not likes/comments/share
- Bug 9: On crop area resize, render style resets (stale closure)
- Bug 10: Crop area size not retained on update (broken persistence end-to-end)

---

## 10. Crop Area Size Not Retained on Update

**Root cause**: Three independent failures that prevent crop box persistence:

1. `handleSave` (`VideoProjectPage.tsx:799-807`) — omits `crop_avatar`/`crop_game` from the update payload sent to the backend.

2. Backend PUT endpoint (`backend/routers/projects.py:298-314`) — no handler for crop fields (`crop_avatar`/`crop_game` are not parsed or saved).

3. Backend GET endpoint (`backend/routers/projects.py:343-358`) — doesn't serialize crop fields in the clip response. Even if the DB had them, the frontend never receives them.

4. `getRenderState` (`VideoProjectPage.tsx:746-749`) — uses hardcoded defaults for crop boxes, never seeding from loaded clip data (even though `Clip` type defines `crop_avatar?: CropBox` / `crop_game?: CropBox`).

**Fix**:
1. Add `crop_avatar`/`crop_game` to the `handleSave` payload and the edit form state so they're sent on clip update.
2. In `projects.py`, add parsing for `crop_avatar`/`crop_game` in the PUT endpoint and serialize them in the GET endpoint.
3. In `getRenderState`, check `clip.crop_avatar` / `clip.crop_game` before falling back to hardcoded defaults.

**Files**: `frontend/src/pages/VideoProjectPage.tsx`, `backend/routers/projects.py`

---

## 9. Render Style Resets on Crop Resize

**Root cause**: Stale closure in `handleCropChange` (`VideoProjectPage.tsx:916`). It's wrapped in `useCallback(fn, [])` — the empty dep array captures the initial render's `renderState` closure. When `updateRenderState` (`:770`) calls `getRenderState(clipId)`, it reads from the stale closure where the clip state is `undefined`, returns fresh defaults, and overwrites all user font/color/subtitle customizations.

**Fix**: Change `updateRenderState` to read from `prev` instead of the closure:
```typescript
setRenderState((prev) => ({
  ...prev,
  [clipId]: { ...(prev[clipId] || getDefaultRenderState()), ...patch },
}));
```
Extract the default state object into a `getDefaultRenderState()` function so it can be reused.

**Files**: `frontend/src/pages/VideoProjectPage.tsx` (~lines 739-778, 916-921)

---

## 7. Crop Area Accordion Doesn't Expand Properly

**Root cause**: `VideoProjectPage.tsx:1425` — the "Crop Areas" section header is a `<div>` with no `onClick`. The toggle is only on a small "+"/"-" icon button. All other collapsible sections use a full-width `<button>` with `onClick` directly on it.

**Fix**: Restructure the header to use a `<button>` wrapping the title + toggle indicator (same pattern as the timing, preview, and subtitle sections). Remove the redundant toggle button and keep only the "Refresh" button as a separate action.

**Files**: `frontend/src/pages/VideoProjectPage.tsx` (~lines 1424-1480)

---

## 8. Missing Social Overlay in Crop Area

**Root cause**: `CropCanvas.tsx:293-320` only draws a "Title bar (12%)" placeholder. There's no like count, comment count, or share button overlay.

**Fix**: Add a semi-transparent bar at the bottom of the crop overlay showing placeholder social elements:
- Heart icon + "12K" (like count)
- Comment icon + "342" (comment count)
- Share icon (share button)
This is a visual positioning guide for the user — not interactive.

**Files**: `frontend/src/components/CropCanvas.tsx` (~line 293)

---

## 6. Crop Area Preview Re-renders Too Frequently

**Root cause**: `VideoProjectPage.tsx:1485` — the `CropCanvas` frameUrl includes `_cb=${Date.now()}`, forcing a new HTTP request on every render. This cache-buster was likely added to force refresh on demand but runs unconditionally.

Additionally, `previewFrameUrl` is computed inline with no `useMemo` in other spots.

**Fix**:
1. Remove the `Date.now()` cache-buster from the CropCanvas frameUrl.
2. Add a "Refresh" button (already exists) as the sole explicit trigger for re-fetching. The Refresh button can increment a `refreshCounter` state to force a new URL.
3. Optionally wrap frameUrl in `useMemo` to skip recomputation on unrelated state changes.

**Files**: `frontend/src/pages/VideoProjectPage.tsx` (~lines 1483-1491)

---

## Implementation Order

1. **Bug 9** — Fix stale closure that resets render style. Fixes the data-loss bug during crop editing.
2. **Bug 10** — Fix crop box persistence (backend + frontend). Foundation — all other fixes depend on crop state being stable.
3. **Bug 7** — Fix accordion toggle. Simple UI fix.
4. **Bug 8** — Add social overlay to crop canvas. Simple visual enhancement.
5. **Bug 6** — Fix excessive re-renders. Performance polish.

## Verification

1. After Bug 10: Set crop boxes, save, reload page — verify crop boxes are restored.
2. After Bug 9: Change subtitle font, then resize crop — verify font setting persists.
3. After Bug 7: Click anywhere on the "Crop Areas" header — verify it expands/collapses.
4. After Bug 8: Verify social overlay appears in the crop canvas (heart, comment, share).
5. After Bug 6: Open dev tools network tab, click unrelated UI (e.g., font picker) — verify no new frame HTTP request fires.
