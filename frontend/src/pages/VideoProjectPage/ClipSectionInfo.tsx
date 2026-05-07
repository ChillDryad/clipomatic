import { useState, useCallback } from "react";
import { twitchTimestamp } from "./utils";
import { formatHms, parseHms } from "../../utils/format";
import type { Clip } from "../../types";

interface ClipSectionInfoProps {
  clip: Clip;
  clipKey: string;
  clipIndex: number;
  originalSource: string | null;
  onClipUpdate: (clipId: string, updated: Clip) => void;
  onSaveTiming: (clipIndex: number, patch: Partial<Clip>) => void;
}

export function ClipSectionInfo({
  clip,
  clipKey,
  clipIndex,
  originalSource,
  onClipUpdate,
  onSaveTiming,
}: ClipSectionInfoProps) {
  const [editing, setEditing] = useState<"start" | "end" | null>(null);
  const [editValue, setEditValue] = useState("");

  const commitTime = useCallback(
    (field: "start" | "end", text: string) => {
      const seconds = parseHms(text);
      if (seconds === null || seconds < 0) return;
      const updated = { ...clip, [field]: seconds };
      onClipUpdate(clipKey, updated);
      onSaveTiming(clipIndex, { [field]: seconds });
      setEditing(null);
    },
    [clip, clipKey, clipIndex, onClipUpdate, onSaveTiming],
  );

  const startHms = formatHms(clip.start);
  const endHms = formatHms(clip.end);

  return (
    <div className="space-y-4">
      {/* Timing — always visible */}
      <div>
        <label className="text-xs font-medium text-[var(--ctp-text)] block mb-2">
          Timing
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">Start</span>
            {editing === "start" ? (
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => commitTime("start", editValue)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTime("start", editValue);
                  if (e.key === "Escape") setEditing(null);
                }}
                autoFocus
                className="input-field font-mono text-sm"
                placeholder="MM:SS or HH:MM:SS"
              />
            ) : (
              <button
                onClick={() => {
                  setEditValue(startHms);
                  setEditing("start");
                }}
                className="input-field font-mono text-sm text-left w-full cursor-text hover:border-[var(--momiji-sakura)] transition-colors"
              >
                {startHms}
              </button>
            )}
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--ctp-subtext)]">End</span>
            {editing === "end" ? (
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => commitTime("end", editValue)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTime("end", editValue);
                  if (e.key === "Escape") setEditing(null);
                }}
                autoFocus
                className="input-field font-mono text-sm"
                placeholder="MM:SS or HH:MM:SS"
              />
            ) : (
              <button
                onClick={() => {
                  setEditValue(endHms);
                  setEditing("end");
                }}
                className="input-field font-mono text-sm text-left w-full cursor-text hover:border-[var(--momiji-sakura)] transition-colors"
              >
                {endHms}
              </button>
            )}
          </label>
        </div>
        <p className="text-xs text-[var(--ctp-subtext)] mt-2">
          Duration: {(clip.end - clip.start).toFixed(1)}s — target is 9–90 seconds.
        </p>
      </div>

      {/* Why This Clip — conditional */}
      {(clip.reason || clip.brand_alignment?.length > 0) && (
        <div className="border-t border-[var(--ctp-overlay)] pt-4">
          <label className="text-xs font-medium text-[var(--ctp-text)] block mb-2">
            Why This Clip
          </label>
          <div className="space-y-2">
            {clip.reason && (
              <div>
                <p className="text-xs text-[var(--ctp-subtext)]">{clip.reason}</p>
              </div>
            )}
            {clip.recommendation_reason && (
              <div>
                <p className="text-xs font-medium text-[var(--ctp-subtext)] mb-0.5">
                  Why Recommended
                </p>
                <p className="text-xs text-[var(--ctp-subtext)] leading-relaxed">
                  {clip.recommendation_reason}
                </p>
              </div>
            )}
            {clip.brand_alignment && clip.brand_alignment.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {clip.brand_alignment.map((pillar, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] px-2 py-0.5 rounded bg-[var(--momiji-sakura)]/20 text-[var(--momiji-sakura)] border border-[var(--momiji-sakura)]/30"
                  >
                    {pillar}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Twitch link — conditional */}
      {originalSource && (
        <div className="border-t border-[var(--ctp-overlay)] pt-3">
          <a
            href={twitchTimestamp(originalSource, clip.start)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[var(--ctp-blue)] hover:opacity-80 break-all"
          >
            {twitchTimestamp(originalSource, clip.start)}
          </a>
        </div>
      )}
    </div>
  );
}
