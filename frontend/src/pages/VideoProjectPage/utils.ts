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
};

export type RenderState = typeof DEFAULT_RENDER_STATE;

export function getClipKey(clip: Clip): string {
  if (clip.id) return clip.id;
  return `clip-${clip.start}-${clip.end}`;
}
