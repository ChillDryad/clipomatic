import { ProgressBar } from "../../components/ui/ProgressBar";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/ToggleGroup";
import { FONT_OPTIONS } from "./utils";

interface ClipSectionSubtitlesProps {
  hasImprovedTranscript: boolean;
  progress: { value: number; label: string } | null;
  model: string;
  onModelChange: (model: string) => void;
  onImprove: () => void;
  fontName: string;
  fontColor: string;
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number;
  fontSize: number;
  captionStyle: string;
  animationSpeed: 'fast' | 'normal' | 'slow';
  qualityPreset: string;
  stylePreset?: string | null;
  nvencAvailable: boolean;
  onUpdate: (patch: Record<string, unknown>) => void;
}

// Preset configurations that auto-update form params
const STYLE_PRESETS: Record<string, {
  font: string;
  size: number;
  fontColor: string;
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number;
  captionStyle: string;
  animationSpeed: 'fast' | 'normal' | 'slow';
}> = {
  tiktok_viral: {
    font: "Arial Black",
    size: 84,
    fontColor: "#FFFFFF",
    highlightColor: "#FFFF00",
    outlineColor: "#000000",
    outlineWidth: 6.0,
    captionStyle: "pop",
    animationSpeed: "fast",
  },
  youtube_pro: {
    font: "Arial",
    size: 72,
    fontColor: "#FFFFFF",
    highlightColor: "#FFD700",
    outlineColor: "#333333",
    outlineWidth: 4.0,
    captionStyle: "karaoke",
    animationSpeed: "normal",
  },
  instagram_reels: {
    font: "Impact",
    size: 80,
    fontColor: "#FFFFFF",
    highlightColor: "#FF00FF",
    outlineColor: "#000000",
    outlineWidth: 5.0,
    captionStyle: "bounce",
    animationSpeed: "normal",
  },
};

export function ClipSectionSubtitles({
  hasImprovedTranscript,
  progress,
  model,
  onModelChange,
  onImprove,
  fontName,
  fontColor,
  highlightColor,
  outlineColor,
  outlineWidth,
  fontSize,
  captionStyle,
  animationSpeed,
  qualityPreset,
  stylePreset,
  nvencAvailable,
  onUpdate,
}: ClipSectionSubtitlesProps) {
  const update = (p: Record<string, unknown>) => onUpdate(p);

  const handlePresetChange = (presetName: string) => {
    const preset = STYLE_PRESETS[presetName];
    if (preset) {
      update({
        stylePreset: presetName,
        fontName: preset.font,
        fontSize: preset.size,
        fontColor: preset.fontColor,
        highlightColor: preset.highlightColor,
        outlineColor: preset.outlineColor,
        outlineWidth: preset.outlineWidth,
        captionStyle: preset.captionStyle,
        animationSpeed: preset.animationSpeed,
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Improve Subtitles — compact */}
      <div>
        <label className="text-xs font-medium text-[var(--ctp-text)] block mb-2">
          Improve Subtitles
        </label>
        <p className="text-xs text-[var(--ctp-subtext)] mb-3">
          Re-transcribe with larger model for better word-level accuracy
        </p>
        <div className="flex items-center gap-3">
          <select
            value={model || "large-v3"}
            onChange={(e) => onModelChange(e.target.value)}
            className="select-field text-xs"
          >
            <option value="medium">medium — fast</option>
            <option value="large-v3">large-v3 — best accuracy</option>
            <option value="large-v3-turbo">large-v3-turbo — balanced</option>
          </select>
          <button
            onClick={onImprove}
            disabled={!!progress || hasImprovedTranscript}
            className="btn-momiji-primary text-xs"
          >
            {progress
              ? "Transcribing…"
              : hasImprovedTranscript
                ? "Done ✓"
                : "Transcribe"}
          </button>
          {hasImprovedTranscript && (
            <span className="text-xs text-[var(--momiji-neon-green)] flex items-center gap-1">
              <span>✓</span> Ready
            </span>
          )}
        </div>
        {progress && (
          <div className="mt-3">
            <ProgressBar progress={progress.value} label={progress.label} />
          </div>
        )}
      </div>

      {/* Style */}
      <div className="border-t border-[var(--ctp-overlay)] pt-4">
        <label className="text-xs font-medium text-[var(--ctp-text)] block mb-3">
          Style
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Font</span>
            <select
              value={fontName}
              onChange={(e) => update({ fontName: e.target.value })}
              className="input-field"
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Size</span>
            <input
              type="number"
              value={fontSize}
              onChange={(e) => update({ fontSize: Number(e.target.value) })}
              min={12}
              max={72}
              className="input-field"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Text color</span>
            <input
              type="color"
              value={fontColor}
              onChange={(e) => update({ fontColor: e.target.value })}
              className="w-full h-8"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Highlight</span>
            <input
              type="color"
              value={highlightColor}
              onChange={(e) => update({ highlightColor: e.target.value })}
              className="w-full h-8"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Outline color</span>
            <input
              type="color"
              value={outlineColor}
              onChange={(e) => update({ outlineColor: e.target.value })}
              className="w-full h-8"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">
              Outline: {outlineWidth.toFixed(1)}px
            </span>
            <input
              type="range"
              value={outlineWidth}
              onChange={(e) => update({ outlineWidth: Number(e.target.value) })}
              min={0}
              max={5}
              step={0.1}
              className="w-full"
            />
          </label>
        </div>

        {/* Caption Style - ToggleGroup */}
        <div className="space-y-2 mt-3">
          <label className="text-xs font-medium text-[var(--ctp-text)]">
            Caption Style
          </label>
          <ToggleGroup
            type="single"
            value={captionStyle}
            onValueChange={(val) => update({ captionStyle: val })}
          >
            <ToggleGroupItem value="karaoke" label="Karaoke" description="Color sweep" />
            <ToggleGroupItem value="capcut" label="CapCut" description="Solid highlight" />
            <ToggleGroupItem value="pop" label="Pop" description="Word bounce" />
            <ToggleGroupItem value="bounce" label="Bounce" description="From below" />
          </ToggleGroup>
        </div>

        {/* Animation Speed — show for pop/bounce styles */}
        {(captionStyle === "pop" || captionStyle === "bounce") && (
          <div className="space-y-2 mt-3">
            <label className="text-xs font-medium text-[var(--ctp-text)]">
              Animation Speed
            </label>
            <ToggleGroup
              type="single"
              value={animationSpeed}
              onValueChange={(val) => update({ animationSpeed: val })}
            >
              <ToggleGroupItem value="fast" label="Fast" />
              <ToggleGroupItem value="normal" label="Normal" />
              <ToggleGroupItem value="slow" label="Slow" />
            </ToggleGroup>
          </div>
        )}

        {/* Style Preset - ToggleGroup */}
        <div className="space-y-2 mt-3">
          <label className="text-xs font-medium text-[var(--ctp-text)]">
            Style Preset
          </label>
          <ToggleGroup
            type="single"
            value={stylePreset || ""}
            onValueChange={handlePresetChange}
          >
            <ToggleGroupItem value="tiktok_viral" label="TikTok" description="84px, Arial Black" />
            <ToggleGroupItem value="youtube_pro" label="YouTube" description="72px, Arial" />
            <ToggleGroupItem value="instagram_reels" label="Instagram" description="80px, Impact" />
          </ToggleGroup>
        </div>

        <div className="flex gap-4 mt-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="quality"
              value="standard"
              checked={qualityPreset === "standard"}
              onChange={() => update({ qualityPreset: "standard" })}
              className="accent-[var(--ctp-mauve)]"
            />
            <div>
              <span className="text-xs text-[var(--ctp-text)] block">Standard</span>
              <span className="text-[10px] text-[var(--ctp-subtext)]">CRF 18</span>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="quality"
              value="production"
              checked={qualityPreset === "production"}
              onChange={() => update({ qualityPreset: "production" })}
              className="accent-[var(--ctp-mauve)]"
            />
            <div>
              <span className="text-xs text-[var(--ctp-text)] block">Production</span>
              <span className="text-[10px] text-[var(--ctp-subtext)]">CRF 12</span>
            </div>
          </label>
          <label
            className={`flex items-center gap-2 ${nvencAvailable ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
          >
            <input
              type="radio"
              name="quality"
              value="nvenc"
              disabled={!nvencAvailable}
              checked={qualityPreset === "nvenc"}
              onChange={() => update({ qualityPreset: "nvenc" })}
              className="accent-[var(--ctp-mauve)]"
            />
            <div>
              <span className="text-xs text-[var(--ctp-text)] block">GPU</span>
              <span className="text-[10px] text-[var(--ctp-subtext)]">
                {nvencAvailable ? "NVENC" : "N/A"}
              </span>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
