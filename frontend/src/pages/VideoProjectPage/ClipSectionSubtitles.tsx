import { ProgressBar } from "../../components/ui/ProgressBar";
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
        <div className="space-y-2 mt-3">
          <label className="text-xs font-medium text-[var(--ctp-text)]">
            Caption Style
          </label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: "karaoke", label: "Karaoke", desc: "Color sweep" },
              { value: "capcut", label: "CapCut", desc: "Solid highlight" },
              { value: "pop", label: "Pop", desc: "Word bounce in" },
              { value: "bounce", label: "Bounce", desc: "From below" },
              { value: "typewriter", label: "Typewriter", desc: "Char reveal" },
              { value: "scale_pulse", label: "Pulse", desc: "Scale emphasis" },
            ].map((style) => (
              <button
                key={style.value}
                onClick={() => update({ captionStyle: style.value })}
                className={`p-2 rounded border text-left ${
                  captionStyle === style.value
                    ? "border-[var(--ctp-mauve)] bg-[var(--ctp-surface-2)]"
                    : "border-[var(--ctp-overlay)] hover:border-[var(--ctp-subtext)]"
                }`}
              >
                <div className="text-xs font-medium">{style.label}</div>
                <div className="text-[10px] text-[var(--ctp-subtext)]">
                  {style.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Animation Speed — show for pop/bounce/typewriter/pulse styles */}
        {(captionStyle === "pop" || captionStyle === "bounce" || captionStyle === "typewriter" || captionStyle === "scale_pulse") && (
          <div className="space-y-2 mt-3">
            <label className="text-xs font-medium text-[var(--ctp-text)]">
              Animation Speed
            </label>
            <div className="flex gap-2">
              {(["fast", "normal", "slow"] as const).map((speed) => (
                <button
                  key={speed}
                  onClick={() => update({ animationSpeed: speed })}
                  className={`flex-1 py-1.5 rounded text-xs capitalize ${
                    animationSpeed === speed
                      ? "bg-[var(--ctp-mauve)] text-[var(--ctp-base)]"
                      : "bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]"
                  }`}
                >
                  {speed}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Style Preset */}
        <div className="space-y-2 mt-3">
          <label className="text-xs font-medium text-[var(--ctp-text)]">
            Style Preset
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "tiktok_viral", label: "TikTok", desc: "84px, Arial Black" },
              { value: "youtube_pro", label: "YouTube", desc: "72px, Arial" },
              { value: "instagram_reels", label: "Instagram", desc: "80px, Impact" },
            ].map((preset) => (
              <button
                key={preset.value}
                onClick={() => update({ stylePreset: preset.value })}
                className={`p-2 rounded border text-left ${
                  stylePreset === preset.value
                    ? "border-[var(--ctp-mauve)] bg-[var(--ctp-surface-2)]"
                    : "border-[var(--ctp-overlay)] hover:border-[var(--ctp-subtext)]"
                }`}
              >
                <div className="text-xs font-medium">{preset.label}</div>
                <div className="text-[10px] text-[var(--ctp-subtext)]">
                  {preset.desc}
                </div>
              </button>
            ))}
          </div>
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
