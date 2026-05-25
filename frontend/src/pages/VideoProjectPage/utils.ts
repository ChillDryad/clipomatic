import type { Clip } from "../../types";

export const getViralityBadgeColor = (score: number): string => {
  if (score >= 80)
    return "bg-[var(--ctp-green)]/20 text-[var(--ctp-green)] border-[var(--ctp-green)]/30";
  if (score >= 60)
    return "bg-[var(--ctp-yellow)]/20 text-[var(--ctp-yellow)] border-[var(--ctp-yellow)]/30";
  return "bg-[var(--ctp-overlay)]/20 text-[var(--ctp-subtext)] border-[var(--ctp-overlay)]/30";
};

export function twitchTimestamp(url: string, seconds: number): string {
  try {
    const vodId = url.match(/twitch\.tv\/videos\/(\d+)/)?.[1];
    if (!vodId) return url;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `https://www.twitch.tv/videos/${vodId}?t=${h}h${m}m${s}s`;
  } catch {
    return url;
  }
}

export const FONT_OPTIONS = [
  { value: "Quicksand", label: "Quicksand (Default)" },
  { value: "Arial", label: "Arial" },
  { value: "Arial Black", label: "Arial Black" },
  { value: "Impact", label: "Impact" },
  { value: "Comic Sans MS", label: "Comic Sans MS" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Courier New", label: "Courier New" },
  { value: "Verdana", label: "Verdana" },
  { value: "Georgia", label: "Georgia" },
  { value: "Palatino Linotype", label: "Palatino Linotype" },
];

export const DEFAULT_RENDER_STATE = {
  progress: null as { value: number; label: string } | null,
  downloadUrl: null as string | null,
  error: null as string | null,
  isCancelling: false,
  cropBoxes: {
    gameplay: { x: 0, y: 0, w: 1344, h: 1080 },
    avatar: { x: 1382, y: 594, w: 518, h: 464 },
  },
  fontName: "Quicksand",
  fontColor: "#FFFFFF",
  highlightColor: "#FFFFFF",
  outlineColor: "#000000",
  outlineWidth: 2.0,
  shadowColor: "#000000",
  shadowDepth: 1.0,
  shadowOpacity: 0.5,
  fontSize: 50,
  subtitleFadeIn: 100,
  subtitleFadeOut: 100,
  captionStyle: "capcut",
  wordsPerLine: 1,
  qualityPreset: "standard",
  layoutMode: "stacked",
  animationSpeed: "normal" as const,
  stylePreset: null as string | null,
};

export type RenderState = typeof DEFAULT_RENDER_STATE;

export function getClipKey(clip: Clip): string {
  if (clip.id) return clip.id;
  return `clip-${clip.start}-${clip.end}`;
}

/**
 * Extract a cropped region from a full video frame using canvas.
 * @param imageSource - The full frame image (HTMLImageElement or string URL)
 * @param cropBox - Crop box in source video coordinates
 * @param videoDimensions - Original video dimensions
 * @param targetWidth - Optional target width for the cropped output
 * @param forceAspectRatio - Optional aspect ratio to force (e.g., 9/16). If not provided, uses crop box's natural aspect ratio.
 * @returns Promise resolving to data URL of cropped image
 */
export async function cropFrame(
  imageSource: HTMLImageElement | string,
  cropBox: { x: number; y: number; w: number; h: number },
  videoDimensions: { w: number; h: number },
  targetWidth?: number,
  forceAspectRatio?: number,
): Promise<string> {
  // Load image if URL provided
  const img =
    typeof imageSource === 'string'
      ? await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.crossOrigin = 'anonymous';
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = imageSource;
        })
      : imageSource;

  // Calculate scale from source video to loaded image
  const scaleX = img.width / videoDimensions.w;
  const scaleY = img.height / videoDimensions.h;
  console.log('[cropFrame] img dimensions:', { w: img.width, h: img.height }, 'videoDimensions:', videoDimensions, 'scale:', { x: scaleX, y: scaleY });

  // Calculate crop dimensions
  const cropX = cropBox.x * scaleX;
  const cropY = cropBox.y * scaleY;
  const cropW = cropBox.w * scaleX;
  const cropH = cropBox.h * scaleY;

  // Create output canvas
  const outW = targetWidth || 270; // Match preview panel width
  const outH = forceAspectRatio
    ? Math.round(outW / forceAspectRatio)
    : Math.round(outW * 16 / 9);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  // Clear canvas with black background (for letterboxing/pillarboxing)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outW, outH);

  // Calculate how to fit the cropped region into the output canvas
  // using "cover" behavior (scale to fill, crop if needed)
  const cropAspect = cropW / cropH;
  const canvasAspect = outW / outH;
  console.log('[cropFrame] cropAspect:', cropAspect.toFixed(3), 'canvasAspect:', canvasAspect.toFixed(3), 'cropW/H:', cropW, cropH, 'outW/H:', outW, outH);

  let drawW: number, drawH: number, drawX: number, drawY: number;

  if (cropAspect > canvasAspect) {
    // Crop is wider than canvas - fit to height, crop sides
    drawH = outH;
    drawW = outH * cropAspect;
    drawX = (outW - drawW) / 2;
    drawY = 0;
    console.log('[cropFrame] branch: wider, drawW/H:', drawW, drawH, 'drawX/Y:', drawX, drawY);
  } else {
    // Crop is taller than canvas - fit to width, crop top/bottom
    // For avatar framing: bias toward showing more head (position 40% from top instead of centered)
    drawW = outW;
    drawH = outW / cropAspect;
    drawX = 0;
    const excessH = drawH - outH;
    drawY = -excessH * 0.4; // Show 40% from top, 60% from bottom
    console.log('[cropFrame] branch: taller, drawW/H:', drawW, drawH, 'drawX/Y:', drawX, drawY, 'excessH:', excessH);
  }

  // Draw cropped region scaled to fill output canvas (cover behavior)
  ctx.drawImage(img, cropX, cropY, cropW, cropH, drawX, drawY, drawW, drawH);

  return canvas.toDataURL('image/jpeg', 0.92);
}
