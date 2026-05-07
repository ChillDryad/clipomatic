import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { ProgressBar } from "../../components/ui/ProgressBar";
import {
  updateClip,
  renderClip,
  downloadSegment,
  getAbortController,
  cancelOperation,
  transcribeSegment,
  getVideoDimensions,
} from "../../api";
import type { Clip, CropBox, Transcript } from "../../types";
import { formatTime } from "../../utils/format";
import { BloomIndicator } from "../../components/ui/BloomIndicator";
import { ClipDetail } from "./ClipDetail";
import { DEFAULT_RENDER_STATE, getClipKey } from "./utils";
import type { RenderState } from "./utils";

interface ClipListProps {
  clips: Clip[];
  selectedIds: Set<string>;
  onToggle: (clipId: string) => void;
  projectId: string;
  onClipUpdate: (clipId: string, updated: Clip) => void;
  sourcePath: string;
  originalSource: string | null;
  nvencAvailable: boolean;
  videoDimensions: { w: number; h: number };
}

export function ClipList({
  clips,
  selectedIds,
  onToggle,
  projectId,
  onClipUpdate,
  sourcePath,
  originalSource,
  nvencAvailable,
  videoDimensions,
}: ClipListProps) {
  const [expandedClipId, setExpandedClipId] = useState<string | null>(null);
  const [cropCanvasKey, setCropCanvasKey] = useState(0);
  const [cropSegmentPaths, setCropSegmentPaths] = useState<Record<string, string>>({});
  const [cropRefreshing, setCropRefreshing] = useState<Record<string, boolean>>({});

  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Clip | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSchedule, setShowSchedule] = useState<string | null>(null);

  const [expandedSections, setExpandedSections] = useState<
    Record<string, { info?: boolean; "preview-crop"?: boolean; subtitles?: boolean }>
  >({});

  const [improvedSegments, setImprovedSegments] = useState<Map<string, Transcript>>(new Map());
  const [improveProgress, setImproveProgress] = useState<
    Record<string, { value: number; label: string } | null>
  >({});
  const [improveModel, setImproveModel] = useState<Record<string, string>>({});

  const [renderState, setRenderState] = useState<Record<string, RenderState>>({});

  const getRenderState = (clipId: string): RenderState => {
    return renderState[clipId] || DEFAULT_RENDER_STATE;
  };

  const updateRenderState = (clipId: string, patch: Partial<RenderState>) => {
    setRenderState((prev) => ({
      ...prev,
      [clipId]: { ...(prev[clipId] || DEFAULT_RENDER_STATE), ...patch },
    }));
  };

  const toggleSection = (
    clipKey: string,
    section: "info" | "preview-crop" | "subtitles",
  ) => {
    setExpandedSections((prev) => ({
      ...prev,
      [clipKey]: { ...prev[clipKey], [section]: !prev[clipKey]?.[section] },
    }));
  };

  const handleEdit = (clip: Clip) => {
    const clipKey = getClipKey(clip);
    setEditingClipId(clipKey);
    setEditForm({ ...clip });
    setExpandedClipId(null);
  };

  const handleSave = async () => {
    if (!editForm || !editingClipId) return;
    setSaving(true);
    try {
      const clipIndex = clips.findIndex((c) => getClipKey(c) === editingClipId);
      if (clipIndex === -1) return;
      const rs = renderState[editingClipId];
      await updateClip(projectId, clipIndex, {
        title: editForm.title,
        start: editForm.start,
        end: editForm.end,
        hashtags: editForm.hashtags,
        brand_alignment: editForm.brand_alignment,
        reason: editForm.reason,
        virality_score: editForm.virality_score,
        crop_avatar: rs?.cropBoxes?.avatar || null,
        crop_game: rs?.cropBoxes?.gameplay || null,
      });
      onClipUpdate(editingClipId, {
        ...editForm,
        crop_avatar: rs?.cropBoxes?.avatar || null,
        crop_game: rs?.cropBoxes?.gameplay || null,
      });
      setEditingClipId(null);
      setEditForm(null);
    } catch (err) {
      console.error("Failed to update clip:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingClipId(null);
    setEditForm(null);
  };

  const handleSaveTiming = async (clipIndex: number, patch: Partial<Clip>) => {
    try {
      await updateClip(projectId, clipIndex, patch);
      const clip = clips[clipIndex];
      if (clip) {
        const clipKey = getClipKey(clip);
        onClipUpdate(clipKey, { ...clip, ...patch });
      }
    } catch (err) {
      console.error("Failed to save timing:", err);
    }
  };

  const handleTimeChange = (field: "start" | "end", value: string) => {
    if (!editForm) return;
    const seconds = parseFloat(value);
    if (!isNaN(seconds)) {
      setEditForm({ ...editForm, [field]: seconds });
    }
  };

  const toggleExpanded = (clipId: string) => {
    if (expandedClipId === clipId) {
      setExpandedClipId(null);
    } else {
      setExpandedClipId(clipId);
      setEditingClipId(null);
      const clip = clips.find((c) => getClipKey(c) === clipId);
      const clipHasCrops = clip?.crop_avatar || clip?.crop_game;
      if (clipHasCrops && !renderState[clipId]) {
        updateRenderState(clipId, {
          cropBoxes: {
            gameplay: clip!.crop_game || DEFAULT_RENDER_STATE.cropBoxes.gameplay,
            avatar: clip!.crop_avatar || DEFAULT_RENDER_STATE.cropBoxes.avatar,
          },
        });
      }
    }
  };

  const handleRender = async (clip: Clip, clipKey: string) => {
    const state = getRenderState(clipKey);
    updateRenderState(clipKey, {
      progress: { value: 0, label: "Starting render..." },
      error: null,
      isCancelling: false,
    });

    try {
      const controller = getAbortController(`render-${clipKey}`);

      let segPath: string;
      let renderStart: number;
      let renderEnd: number;

      const isUrl =
        originalSource?.startsWith("http://") ||
        originalSource?.startsWith("https://");
      const isVideoFile = /\.(mp4|mkv|mov)$/i.test(sourcePath);

      if (isUrl && originalSource) {
        segPath = await downloadSegment(
          originalSource,
          clip.start,
          clip.end,
          (value, label) =>
            updateRenderState(clipKey, {
              progress: { value: value * 0.4, label },
            }),
          controller.signal,
        );
        const duration = clip.end - clip.start;
        renderStart = 0;
        renderEnd = duration;
      } else if (isVideoFile) {
        segPath = sourcePath;
        renderStart = clip.start;
        renderEnd = clip.end;
      } else {
        throw new Error(
          "Cannot render: the source file is audio-only and no original video URL is available. " +
            "Upload a video file or provide a YouTube/Twitch URL to render clips.",
        );
      }

      updateRenderState(clipKey, {
        progress: { value: 0.4, label: "Rendering clip..." },
      });

      const outUrl = await renderClip(
        {
          video_path: segPath,
          clip: { ...clip, start: renderStart, end: renderEnd },
          crop_avatar: state.cropBoxes.avatar,
          crop_game: state.cropBoxes.gameplay,
          segments: [],
          font_name: state.fontName,
          font_color: state.fontColor,
          highlight_color: state.highlightColor,
          outline_color: state.outlineColor,
          outline_width: state.outlineWidth,
          shadow_color: state.shadowColor,
          shadow_depth: state.shadowDepth,
          shadow_opacity: state.shadowOpacity,
          font_size: state.fontSize,
          subtitle_fade_in_ms: state.subtitleFadeIn,
          subtitle_fade_out_ms: state.subtitleFadeOut,
          caption_style: state.captionStyle,
          words_per_line: state.wordsPerLine,
          quality_preset: state.qualityPreset,
          layout_mode: state.layoutMode,
        },
        (value, label) =>
          updateRenderState(clipKey, {
            progress: { value: 0.4 + value * 0.6, label },
          }),
        controller.signal,
      );

      updateRenderState(clipKey, { progress: null, downloadUrl: outUrl });
    } catch (err) {
      if (String(err).includes("cancelled")) {
        updateRenderState(clipKey, {
          progress: null,
          error: "Render cancelled",
        });
      } else {
        updateRenderState(clipKey, { progress: null, error: String(err) });
      }
    }
  };

  const handleRenderCancel = (clipKey: string) => {
    updateRenderState(clipKey, { isCancelling: true });
    cancelOperation(`render-${clipKey}`);
  };

  const handleCropChange = useCallback(
    (clipKey: string) => (gameplay: CropBox, avatar: CropBox) => {
      updateRenderState(clipKey, { cropBoxes: { gameplay, avatar } });
    },
    [],
  );

  const handleRefreshCrop = async (clip: Clip, clipKey: string) => {
    const source = originalSource || sourcePath;
    const isUrl = source.startsWith("http://") || source.startsWith("https://");

    if (isUrl) {
      setCropRefreshing((prev) => ({ ...prev, [clipKey]: true }));
      try {
        const segPath = await downloadSegment(source, clip.start, clip.end, () => {});
        setCropSegmentPaths((prev) => ({ ...prev, [clipKey]: segPath }));
      } catch (err) {
        console.error("Failed to download segment for crop refresh:", err);
      } finally {
        setCropRefreshing((prev) => ({ ...prev, [clipKey]: false }));
      }
    }

    setCropCanvasKey((prev) => prev + 1);
  };

  const handleImproveSubtitles = async (clip: Clip, clipKey: string) => {
    setImproveProgress((prev) => ({
      ...prev,
      [clipKey]: { value: 0, label: "Starting…" },
    }));
    const key = `${sourcePath}___${clip.start}___${clip.end}`;
    const model = improveModel[clipKey] || "large-v3";
    try {
      const result = await transcribeSegment(
        {
          video_path: sourcePath,
          start: clip.start,
          end: clip.end,
          model_size: model,
          device: "auto",
        },
        (value, label) =>
          setImproveProgress((prev) => ({
            ...prev,
            [clipKey]: { value, label },
          })),
      );
      setImprovedSegments((prev) => new Map(prev).set(key, result));
      setImproveProgress((prev) => ({ ...prev, [clipKey]: null }));
    } catch (err) {
      setImproveProgress((prev) => ({ ...prev, [clipKey]: null }));
      console.error("Improve subtitles failed:", err);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {clips.map((clip) => {
          const clipKey = getClipKey(clip);
          const isEditing = editingClipId === clipKey;
          const isExpanded = expandedClipId === clipKey;
          const state = getRenderState(clipKey);
          const improvedKey = `${sourcePath}___${clip.start}___${clip.end}`;
          const hasImprovedTranscript = improvedSegments.has(improvedKey);

          if (isEditing && editForm) {
            return (
              <div
                key={clipKey}
                className="col-span-full glass-card p-4 animate-expand"
                role="listitem"
                style={{ animation: "slideDown 0.3s ease-out" }}
              >
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-[var(--ctp-subtext)] block mb-1">
                      Title
                    </label>
                    <input
                      type="text"
                      value={editForm.title}
                      onChange={(e) =>
                        setEditForm({ ...editForm, title: e.target.value })
                      }
                      className="glass-input input-field text-sm"
                      placeholder="Clip title"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-[var(--ctp-subtext)] block mb-1">
                        Start (seconds)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={editForm.start}
                        onChange={(e) =>
                          handleTimeChange("start", e.target.value)
                        }
                        className="glass-input input-field text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--ctp-subtext)] block mb-1">
                        End (seconds)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={editForm.end}
                        onChange={(e) =>
                          handleTimeChange("end", e.target.value)
                        }
                        className="glass-input input-field text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--ctp-subtext)] block mb-1">
                      Reason
                    </label>
                    <textarea
                      value={editForm.reason || ""}
                      onChange={(e) =>
                        setEditForm({ ...editForm, reason: e.target.value })
                      }
                      className="glass-input input-field text-sm"
                      rows={2}
                      placeholder="Why this clip is viral"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--ctp-subtext)] block mb-1">
                      Hashtags (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={editForm.hashtags.join(", ")}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          hashtags: e.target.value
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                      className="glass-input input-field text-sm"
                      placeholder="#viral, #fyp, #gaming"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--ctp-subtext)] block mb-1">
                      Brand Alignment (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={editForm.brand_alignment.join(", ")}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          brand_alignment: e.target.value
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                      className="glass-input input-field text-sm"
                      placeholder="cozy energy, gap moe"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      onClick={handleSave}
                      variant="primary"
                      size="sm"
                      disabled={saving}
                    >
                      {saving ? "Saving..." : "Save"}
                    </Button>
                    <Button
                      onClick={handleCancel}
                      variant="secondary"
                      size="sm"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            );
          }

          if (isExpanded) {
            return (
              <ClipDetail
                key={clipKey}
                clip={clip}
                clipKey={clipKey}
                clipIndex={clips.findIndex((c) => getClipKey(c) === clipKey)}
                renderState={state}
                updateRenderState={updateRenderState}
                expandedSections={expandedSections}
                toggleSection={toggleSection}
                onCollapse={() => setExpandedClipId(null)}
                onSchedule={setShowSchedule}
                onRender={handleRender}
                onRenderCancel={handleRenderCancel}
                onCropChange={handleCropChange}
                onRefreshCrop={handleRefreshCrop}
                cropCanvasKey={cropCanvasKey}
                cropSegmentPaths={cropSegmentPaths}
                cropRefreshing={cropRefreshing}
                sourcePath={sourcePath}
                originalSource={originalSource}
                videoDimensions={videoDimensions}
                nvencAvailable={nvencAvailable}
                hasImprovedTranscript={hasImprovedTranscript}
                improveProgress={improveProgress[clipKey] ?? null}
                improveModel={improveModel[clipKey] ?? "large-v3"}
                onImproveSubtitles={handleImproveSubtitles}
                projectId={projectId}
                onClipUpdate={onClipUpdate}
                onSaveTiming={handleSaveTiming}
              />
            );
          }

          // Collapsed card
          return (
            <div key={clipKey} className="glass-card p-3 col-span-1" role="listitem">
              <div className="flex flex-col h-full">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <label htmlFor={`clip-checkbox-${clipKey}`} className="sr-only">
                      Select {clip.title}
                    </label>
                    <input
                      id={`clip-checkbox-${clipKey}`}
                      type="checkbox"
                      checked={selectedIds.has(clipKey)}
                      onChange={() => onToggle(clipKey)}
                      className="accent-[var(--ctp-mauve)] w-4 h-4 cursor-pointer flex-shrink-0"
                    />
                    <h3 className="font-semibold text-[var(--ctp-text)] text-sm line-clamp-2 flex-1">
                      {clip.title || "Untitled Clip"}
                    </h3>
                  </div>
                  <BloomIndicator score={clip.virality_score || 0} size="sm" />
                </div>

                <p className="text-xs text-[var(--ctp-subtext)] mb-2">
                  {formatTime(clip.start)} - {formatTime(clip.end)}
                  <span className="ml-1 opacity-60">
                    ({(clip.end - clip.start).toFixed(0)}s)
                  </span>
                </p>

                {(clip.brand_alignment || []).length > 0 && (
                  <p className="text-[10px] text-[var(--ctp-subtext)] mb-2 line-clamp-1">
                    {(clip.brand_alignment || []).join(", ")}
                  </p>
                )}
                {clip.reason && (
                  <p className="text-[10px] text-[var(--ctp-subtext)] mb-2 line-clamp-2">
                    {clip.reason}
                  </p>
                )}

                <div className="flex gap-1 mt-2 pt-2 border-t border-[var(--ctp-overlay)]/50">
                  <button
                    onClick={() => handleEdit(clip)}
                    className="btn-secondary text-xs py-1 flex-1"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => toggleExpanded(clipKey)}
                    className="btn-secondary text-xs py-1 flex-1"
                  >
                    Preview
                  </button>
                </div>
                <Link
                  to={`/video/${projectId}/timeline/${clip.id || clip.index}`}
                  className="btn-secondary text-xs py-1 text-center block mt-1"
                >
                  Timeline Editor
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {selectedIds.size > 0 && (
        <div className="glass-card p-4 flex gap-3 items-center sticky bottom-4">
          <span className="text-[var(--ctp-subtext)]">
            {selectedIds.size} selected
          </span>
          <Button variant="primary" onClick={() => {}}>
            Render Selected
          </Button>
          <Button variant="secondary" onClick={() => {}}>
            Schedule Posts
          </Button>
        </div>
      )}
    </>
  );
}
