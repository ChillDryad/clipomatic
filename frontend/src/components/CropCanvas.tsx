import { useRef, useState, useCallback, useEffect } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect, Text, Transformer } from 'react-konva'
import useImage from 'use-image'
import type Konva from 'konva'
import type { CropBox } from '../types'

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
}

export function CropCanvas({ frameUrl, videoDimensions, initialGameplay, initialAvatar, onChange }: Props) {
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

  // Don't render canvas if no image or invalid dimensions
  if (!frameUrl || canvasW <= 0 || canvasH <= 0) {
    return (
      <div className="crop-canvas-wrapper" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <p className="text-xs text-[var(--ctp-subtext)]">
          {!frameUrl ? 'No preview available' : 'Loading preview...'}
        </p>
      </div>
    )
  }

  // Default crop boxes (source coordinates scaled to canvas)
  // Gameplay: left 70% of source, full height
  // Avatar: right 27% of source, centered vertically
  const defaultGameplay: RectState = initialGameplay
    ? { x: initialGameplay.x * sourceScale, y: initialGameplay.y * sourceScale, width: initialGameplay.w * sourceScale, height: initialGameplay.h * sourceScale }
    : { x: 0, y: 0, width: Math.round(canvasW * 0.70), height: canvasH }
  const defaultAvatar: RectState = initialAvatar
    ? { x: initialAvatar.x * sourceScale, y: initialAvatar.y * sourceScale, width: initialAvatar.w * sourceScale, height: initialAvatar.h * sourceScale }
    : { x: Math.round(canvasW * 0.72), y: Math.round(canvasH * 0.55), width: Math.round(canvasW * 0.27), height: Math.round(canvasH * 0.43) }

  const [gameplay, setGameplay] = useState<RectState>(defaultGameplay)
  const [avatar, setAvatar] = useState<RectState>(defaultAvatar)
  const [selected, setSelected] = useState<'gameplay' | 'avatar' | null>(null)

  const gameplayRef = useRef<Konva.Rect>(null)
  const avatarRef = useRef<Konva.Rect>(null)
  const transformerRef = useRef<Konva.Transformer>(null)

  const initialized = useRef(false)
  // Sync initial crop values when first set by parent
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
    const next: RectState = {
      x: ref.x(),
      y: ref.y(),
      width: Math.max(20, ref.width() * scaleX),
      height: Math.max(20, ref.height() * scaleY),
    }
    if (target === 'gameplay') { setGameplay(next); notify(next, avatar) }
    else { setAvatar(next); notify(gameplay, next) }
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
            style={{ borderRadius: 8 }}
            onMouseDown={(e) => { if (e.target === e.target.getStage()) setSelected(null) }}
          >
          <Layer>
            {/* Background: source video frame with padding */}
            <Rect width={canvasW + CANVAS_PADDING * 2} height={canvasH + CANVAS_PADDING * 2} fill="#1e1e2e" listening={false} />
            {imageStatus === 'loaded' && image
              ? <KonvaImage image={image} x={CANVAS_PADDING} y={CANVAS_PADDING} width={canvasW} height={canvasH} listening={false} />
              : null
            }
            {imageStatus === 'loading' && (
              <Text text="Loading preview..." x={canvasW / 2 + CANVAS_PADDING} y={canvasH / 2 + CANVAS_PADDING} fill="#888" fontSize={14} offsetX={50} offsetY={10} />
            )}
            {imageStatus === 'failed' && (
              <Text text="Preview unavailable" x={canvasW / 2 + CANVAS_PADDING} y={canvasH / 2 + CANVAS_PADDING} fill="#888" fontSize={14} offsetX={60} offsetY={10} />
            )}

            {/* Gameplay box */}
            <Rect
              ref={gameplayRef}
              x={gameplay.x} y={gameplay.y}
              width={gameplay.width} height={gameplay.height}
              fill="rgba(137,180,250,0.12)"
              stroke="#89b4fa"
              strokeWidth={selected === 'gameplay' ? 3 : 2}
              draggable
              onClick={() => setSelected('gameplay')}
              onTap={() => setSelected('gameplay')}
              onDragEnd={(e) => {
                const next = { ...gameplay, x: e.target.x(), y: e.target.y() }
                setGameplay(next); notify(next, avatar)
              }}
              onTransformEnd={() => handleTransformEnd('gameplay')}
            />
            <Text
              x={gameplay.x + 6} y={gameplay.y + 6}
              text="Gameplay"
              fontSize={13} fontStyle="bold"
              fill="#89b4fa"
              shadowColor="black" shadowBlur={4} shadowOpacity={0.8}
              listening={false}
            />

            {/* Avatar / facecam box */}
            <Rect
              ref={avatarRef}
              x={avatar.x} y={avatar.y}
              width={avatar.width} height={avatar.height}
              fill="rgba(203,166,247,0.12)"
              stroke="#cba6f7"
              strokeWidth={selected === 'avatar' ? 3 : 2}
              draggable
              onClick={() => setSelected('avatar')}
              onTap={() => setSelected('avatar')}
              onDragEnd={(e) => {
                const next = { ...avatar, x: e.target.x(), y: e.target.y() }
                setAvatar(next); notify(gameplay, next)
              }}
              onTransformEnd={() => handleTransformEnd('avatar')}
            />
            <Text
              x={avatar.x + 6} y={avatar.y + 6}
              text="Facecam"
              fontSize={13} fontStyle="bold"
              fill="#cba6f7"
              shadowColor="black" shadowBlur={4} shadowOpacity={0.8}
              listening={false}
            />

            <Transformer
              ref={transformerRef}
              rotateEnabled={false}
              boundBoxFunc={(old, next) =>
                next.width < 20 || next.height < 20 ? old : next
              }
            />
          </Layer>
        </Stage>
        </div>
      </div>

      <div className="flex gap-6 text-xs text-[var(--ctp-subtext)] font-mono">
        <span className="crop-label-pill text-[var(--ctp-blue)]">Gameplay {gpBox.w}×{gpBox.h} @ ({gpBox.x},{gpBox.y})</span>
        <span className="crop-label-pill text-[var(--ctp-mauve)]">Facecam {avBox.w}×{avBox.h} @ ({avBox.x},{avBox.y})</span>
      </div>
    </div>
  )
}
