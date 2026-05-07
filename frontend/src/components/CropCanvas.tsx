import { useRef, useState, useCallback, useEffect } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect, Text, Transformer, Group } from 'react-konva'
import useImage from 'use-image'
import type Konva from 'konva'
import type { CropBox } from '../types'

/** Compute a 9:16 centered crop box from source video dimensions. */
export function centeredCropBox9x16(videoW: number, videoH: number): CropBox {
  let cropH = videoH
  let cropW = Math.round(cropH * 9 / 16)
  if (cropW > videoW) {
    cropW = videoW
    cropH = Math.round(cropW * 16 / 9)
  }
  const x = Math.round((videoW - cropW) / 2)
  const y = Math.round((videoH - cropH) / 2)
  return { x, y, w: cropW, h: cropH }
}

// Maximum canvas display size - scale video to fit within 1280x720
const MAX_CANVAS_W = 1280
const MAX_CANVAS_H = 720
const CANVAS_PADDING = 20 // Padding around image for crop box breathing room

interface RectState {
  x: number
  y: number
  width: number
  height: number
}

interface Props {
  frameUrl: string | null
  videoDimensions: { w: number; h: number }
  initialGameplay?: CropBox
  initialAvatar?: CropBox
  onChange: (gameplay: CropBox, avatar: CropBox) => void
  layoutMode?: string
  title?: string
}

export function CropCanvas({ frameUrl, videoDimensions, initialGameplay, initialAvatar, onChange, layoutMode, title }: Props) {
  // No crossOrigin param — avoids CORS preflight that blocks same-origin proxied images
  const [image, imageStatus] = useImage(frameUrl || '', 'anonymous')

  // Scale source video to fit within 1280x720 while maintaining aspect ratio
  const sourceAspect = videoDimensions.w / videoDimensions.h
  const maxAspect = MAX_CANVAS_W / MAX_CANVAS_H

  let canvasW: number, canvasH: number
  if (sourceAspect > maxAspect) {
    // Source is wider - fit to width
    canvasW = MAX_CANVAS_W - CANVAS_PADDING * 2
    canvasH = Math.round((MAX_CANVAS_W - CANVAS_PADDING * 2) / sourceAspect)
  } else {
    // Source is taller - fit to height
    canvasH = MAX_CANVAS_H - CANVAS_PADDING * 2
    canvasW = Math.round((MAX_CANVAS_H - CANVAS_PADDING * 2) * sourceAspect)
  }

  // Calculate scale factor from source to canvas
  const sourceScale = canvasW / videoDimensions.w

  const isSingleMode = layoutMode === "camera_only" || layoutMode === "gameplay_only"
  const lockedRatio = isSingleMode ? 9 / 16 : undefined

  // Don't render canvas if no image or invalid dimensions
  if (!frameUrl || canvasW <= 0 || canvasH <= 0) {
    return (
      <div className="crop-canvas-wrapper" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <p className="text-xs text-[var(--momiji-subtext)]">
          {!frameUrl ? 'No preview available' : 'Loading preview...'}
        </p>
      </div>
    )
  }

  // Default crop boxes (source coordinates scaled to canvas)
  // Stacked: Gameplay left 70%, Avatar right 27% — these NEVER change
  // Single mode: 9:16 crop centered in the frame
  const stackedGameplay: RectState = initialGameplay
    ? { x: initialGameplay.x * sourceScale, y: initialGameplay.y * sourceScale, width: initialGameplay.w * sourceScale, height: initialGameplay.h * sourceScale }
    : { x: 0, y: 0, width: Math.round(canvasW * 0.70), height: canvasH }
  const stackedAvatar: RectState = initialAvatar
    ? { x: initialAvatar.x * sourceScale, y: initialAvatar.y * sourceScale, width: initialAvatar.w * sourceScale, height: initialAvatar.h * sourceScale }
    : { x: Math.round(canvasW * 0.72), y: Math.round(canvasH * 0.55), width: Math.round(canvasW * 0.27), height: Math.round(canvasH * 0.43) }

  const singleDefaultSrc = centeredCropBox9x16(videoDimensions.w, videoDimensions.h)
  const singleDefault: RectState = {
    x: singleDefaultSrc.x * sourceScale,
    y: singleDefaultSrc.y * sourceScale,
    width: singleDefaultSrc.w * sourceScale,
    height: singleDefaultSrc.h * sourceScale,
  }

  const defaultGameplay: RectState = isSingleMode ? singleDefault : stackedGameplay
  const defaultAvatar: RectState = isSingleMode ? singleDefault : stackedAvatar

  const [gameplay, setGameplay] = useState<RectState>(defaultGameplay)
  const [avatar, setAvatar] = useState<RectState>(defaultAvatar)
  const [selected, setSelected] = useState<'gameplay' | 'avatar' | null>(null)

  const gameplayRef = useRef<Konva.Rect>(null)
  const avatarRef = useRef<Konva.Rect>(null)
  const transformerRef = useRef<Konva.Transformer>(null)

  const initialized = useRef(false)
  const prevLayoutMode = useRef(layoutMode)
  // Re-sync when layout mode changes
  if (prevLayoutMode.current !== layoutMode) {
    prevLayoutMode.current = layoutMode
    initialized.current = false
  }
  // Sync initial crop values when first set by parent or when mode changes
  useEffect(() => {
    if (initialized.current) return
    if (initialGameplay) {
      setGameplay({ x: initialGameplay.x * sourceScale, y: initialGameplay.y * sourceScale, width: initialGameplay.w * sourceScale, height: initialGameplay.h * sourceScale })
    }
    if (initialAvatar) {
      setAvatar({ x: initialAvatar.x * sourceScale, y: initialAvatar.y * sourceScale, width: initialAvatar.w * sourceScale, height: initialAvatar.h * sourceScale })
    }
    if (initialGameplay || initialAvatar) {
      initialized.current = true
    }
  }, [initialGameplay, initialAvatar, sourceScale, videoDimensions])

  // Attach transformer to selected rect
  useEffect(() => {
    const tr = transformerRef.current
    if (!tr) return
    const node =
      selected === 'gameplay'
        ? gameplayRef.current
        : selected === 'avatar'
        ? avatarRef.current
        : null
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selected])

  const toBox = useCallback(
    (r: RectState): CropBox => ({
      x: Math.round(r.x / sourceScale),
      y: Math.round(r.y / sourceScale),
      w: Math.round(r.width / sourceScale),
      h: Math.round(r.height / sourceScale),
    }),
    [sourceScale],
  )

  const notify = useCallback(
    (g: RectState, a: RectState) => onChange(toBox(g), toBox(a)),
    [onChange, toBox],
  )

  const handleTransformEnd = (target: 'gameplay' | 'avatar') => {
    const ref = target === 'gameplay' ? gameplayRef.current : avatarRef.current
    if (!ref) return
    const scaleX = ref.scaleX()
    const scaleY = ref.scaleY()
    ref.scaleX(1)
    ref.scaleY(1)
    let nextW = Math.max(20, ref.width() * scaleX)
    let nextH = Math.max(20, ref.height() * scaleY)
    let nextX = ref.x()
    let nextY = ref.y()

    // Enforce locked aspect ratio for single-rect modes
    if (lockedRatio !== undefined) {
      const cx = nextX + nextW / 2
      const cy = nextY + nextH / 2
      nextH = Math.max(20, nextH)
      nextW = nextH * lockedRatio
      // Clamp to canvas bounds
      if (nextW > canvasW) {
        nextW = canvasW
        nextH = nextW / lockedRatio
      }
      if (nextH > canvasH) {
        nextH = canvasH
        nextW = nextH * lockedRatio
      }
      nextX = cx - nextW / 2
      nextY = cy - nextH / 2
      nextX = Math.max(0, Math.min(nextX, canvasW - nextW))
      nextY = Math.max(0, Math.min(nextY, canvasH - nextH))
    }

    const nextRect: RectState = { x: nextX, y: nextY, width: nextW, height: nextH }
    if (target === 'gameplay') { setGameplay(nextRect); notify(nextRect, avatar) }
    else { setAvatar(nextRect); notify(gameplay, nextRect) }
  }

  const gpBox = toBox(gameplay)
  const avBox = toBox(avatar)

  return (
    <div className="space-y-2">
      {/* Crop canvas with scrollable container for large videos */}
      <div className="crop-canvas-wrapper" style={{
        display: 'flex',
        justifyContent: 'center',
        maxWidth: '100%',
        overflow: 'auto',
      }}>
        <div style={{
          width: canvasW,
          height: canvasH,
          minWidth: canvasW,
          minHeight: canvasH,
        }}>
          <Stage
            width={canvasW + CANVAS_PADDING * 2}
            height={canvasH + CANVAS_PADDING * 2}
            style={{ borderRadius: 12 }}
            onMouseDown={(e) => { if (e.target === e.target.getStage()) setSelected(null) }}
          >
          <Layer>
            {/* Background: source video frame with padding */}
            <Rect width={canvasW + CANVAS_PADDING * 2} height={canvasH + CANVAS_PADDING * 2} fill="var(--momiji-surface)" listening={false} />
            {imageStatus === 'loaded' && image
              ? <KonvaImage image={image} x={CANVAS_PADDING} y={CANVAS_PADDING} width={canvasW} height={canvasH} listening={false} />
              : null
            }
            {imageStatus === 'loading' && (
              <Text text="Loading preview..." x={canvasW / 2 + CANVAS_PADDING} y={canvasH / 2 + CANVAS_PADDING} fill="var(--momiji-subtext)" fontSize={14} offsetX={50} offsetY={10} />
            )}
            {imageStatus === 'failed' && (
              <Text text="Preview unavailable" x={canvasW / 2 + CANVAS_PADDING} y={canvasH / 2 + CANVAS_PADDING} fill="var(--momiji-subtext)" fontSize={14} offsetX={60} offsetY={10} />
            )}

            {/* Gameplay box — hidden in camera_only mode */}
            {layoutMode !== 'camera_only' && (
              <>
                <Rect
                  ref={gameplayRef}
                  x={gameplay.x} y={gameplay.y}
                  width={gameplay.width} height={gameplay.height}
                  fill="transparent"
                  stroke="#ffb7c5"
                  strokeWidth={selected === 'gameplay' ? 3 : 2}
                  cornerRadius={8}
                  draggable
                  onClick={() => setSelected('gameplay')}
                  onTap={() => setSelected('gameplay')}
                  onDragEnd={(e) => {
                    const next = { ...gameplay, x: e.target.x(), y: e.target.y() }
                    setGameplay(next); notify(next, avatar)
                  }}
                  onTransformEnd={() => handleTransformEnd('gameplay')}
                />
                {/* MacBook-style notch centered at top */}
                <Group x={gameplay.x + gameplay.width / 2} y={gameplay.y} offsetX={0} offsetY={0}>
                  {/* Notch background with rounded top corners */}
                  <Rect
                    x={-50} y={0}
                    width={100} height={28}
                    fill="#ffb7c5"
                    cornerRadius={8}
                    listening={false}
                  />
                  {/* Notch text */}
                  <Text
                    x={0} y={7}
                    text="🎮 Gameplay"
                    fontSize={12} fontStyle="bold"
                    fill="#1a1a2e"
                    offsetX={45} offsetY={0}
                    listening={false}
                  />
                </Group>
              </>
            )}

            {/* Avatar / facecam box — hidden in gameplay_only mode */}
            {layoutMode !== 'gameplay_only' && (
              <>
                <Rect
                  ref={avatarRef}
                  x={avatar.x} y={avatar.y}
                  width={avatar.width} height={avatar.height}
                  fill="transparent"
                  stroke="#00ff9d"
                  strokeWidth={selected === 'avatar' ? 3 : 2}
                  cornerRadius={8}
                  draggable
                  onClick={() => setSelected('avatar')}
                  onTap={() => setSelected('avatar')}
                  onDragEnd={(e) => {
                    const next = { ...avatar, x: e.target.x(), y: e.target.y() }
                    setAvatar(next); notify(gameplay, next)
                  }}
                  onTransformEnd={() => handleTransformEnd('avatar')}
                />
                {/* MacBook-style notch centered at top */}
                <Group x={avatar.x + avatar.width / 2} y={avatar.y} offsetX={0} offsetY={0}>
                  {/* Notch background with rounded top corners */}
                  <Rect
                    x={-45} y={0}
                    width={90} height={28}
                    fill="#00ff9d"
                    cornerRadius={8}
                    listening={false}
                  />
                  {/* Notch text */}
                  <Text
                    x={0} y={7}
                    text="📹 Facecam"
                    fontSize={12} fontStyle="bold"
                    fill="#1a1a2e"
                    offsetX={38} offsetY={0}
                    listening={false}
                  />
                </Group>
              </>
            )}

            {/* UI overlay for single-rect modes: title bar (bottom 12%) + social column stacked on top (45% height, 50px wide) */}
            {isSingleMode && (() => {
              const box = layoutMode === 'camera_only' ? avatar : gameplay
              const titleBarH = box.height * 0.12
              const titleBarY = box.y + box.height - titleBarH
              const socialW = 50
              const socialH = box.height * 0.45
              const socialY = titleBarY - socialH
              const iconSize = Math.max(14, Math.min(20, socialH * 0.06))
              const textFontSize = Math.max(9, Math.min(11, socialH * 0.04))
              const itemH = socialH / 3
              return (
                <>
                  {/* Social column stacked on top of title bar (right side) */}
                  <Rect
                    x={box.x + box.width - socialW} y={socialY}
                    width={socialW} height={socialH}
                    fill="rgba(0,0,0,0.35)"
                    listening={false}
                  />
                  {/* Like - top third */}
                  <Text
                    x={box.x + box.width - socialW + socialW * 0.5} y={socialY + itemH * 0.35}
                    text="♥"
                    fontSize={iconSize}
                    fill="rgba(255,255,255,0.85)"
                    align="center"
                    listening={false}
                  />
                  <Text
                    x={box.x + box.width - socialW + socialW * 0.5} y={socialY + itemH * 0.65}
                    text="12K"
                    fontSize={textFontSize}
                    fill="rgba(255,255,255,0.65)"
                    align="center"
                    listening={false}
                  />
                  {/* Comment - middle third */}
                  <Text
                    x={box.x + box.width - socialW + socialW * 0.5} y={socialY + itemH * 1.35}
                    text="💬"
                    fontSize={iconSize}
                    fill="rgba(255,255,255,0.85)"
                    align="center"
                    listening={false}
                  />
                  <Text
                    x={box.x + box.width - socialW + socialW * 0.5} y={socialY + itemH * 1.65}
                    text="342"
                    fontSize={textFontSize}
                    fill="rgba(255,255,255,0.65)"
                    align="center"
                    listening={false}
                  />
                  {/* Share - bottom third */}
                  <Text
                    x={box.x + box.width - socialW + socialW * 0.5} y={socialY + itemH * 2.35}
                    text="↗"
                    fontSize={iconSize}
                    fill="rgba(255,255,255,0.85)"
                    align="center"
                    listening={false}
                  />
                  <Text
                    x={box.x + box.width - socialW + socialW * 0.5} y={socialY + itemH * 2.65}
                    text="Share"
                    fontSize={textFontSize}
                    fill="rgba(255,255,255,0.65)"
                    align="center"
                    listening={false}
                  />
                  {/* Title bar at bottom (12%, full width) */}
                  <Rect
                    x={box.x} y={titleBarY}
                    width={box.width} height={titleBarH}
                    fill="rgba(0,0,0,0.45)"
                    stroke="rgba(255,255,255,0.2)"
                    strokeWidth={1}
                    dash={[6, 4]}
                    listening={false}
                  />
                  {/* Title text */}
                  <Text
                    x={box.x + 8} y={titleBarY + titleBarH * 0.35}
                    width={box.width - 16}
                    text={title || "Clip title"}
                    fontSize={Math.max(8, Math.min(14, titleBarH * 0.45))}
                    fill="rgba(255,255,255,0.75)"
                    listening={false}
                  />
                </>
              )
            })()}

            <Transformer
              ref={transformerRef}
              rotateEnabled={false}
              boundBoxFunc={(old, next) => {
                if (next.width < 20 || next.height < 20) return old
                if (lockedRatio !== undefined) {
                  const snappedW = Math.max(20, Math.min(next.height * lockedRatio, canvasW))
                  return { ...next, width: snappedW }
                }
                return next
              }}
            />
          </Layer>
        </Stage>
        </div>
      </div>

      <div className="flex gap-6 text-xs font-mono">
        {layoutMode !== 'camera_only' && (
          <span className="crop-label-pill px-2 py-1 rounded-md" style={{ background: 'rgba(255, 183, 197, 0.1)', color: 'var(--momiji-sakura)', border: '1px solid rgba(255, 183, 197, 0.2)' }}>
            Gameplay {gpBox.w}×{gpBox.h}
          </span>
        )}
        {layoutMode !== 'gameplay_only' && (
          <span className="crop-label-pill px-2 py-1 rounded-md" style={{ background: 'rgba(0, 255, 157, 0.1)', color: 'var(--momiji-neon-green)', border: '1px solid rgba(0, 255, 157, 0.2)' }}>
            Facecam {avBox.w}×{avBox.h}
          </span>
        )}
      </div>
    </div>
  )
}
