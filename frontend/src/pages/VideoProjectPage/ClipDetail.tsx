import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { BloomIndicator } from "../../components/ui/BloomIndicator";
import { formatTime } from "../../utils/format";
import type { Clip, CropBox } from "../../types";
import type { RenderState } from "./utils";
import { ClipSectionInfo } from "./ClipSectionInfo";
import { ClipSectionPreviewCrop } from "./ClipSectionPreviewCrop";
import { ClipSectionSubtitles } from "./ClipSectionSubtitles";
import { ClipSectionRender } from "./ClipSectionRender";

interface ClipDetailProps {
  clip: Clip;
  clipKey: string;
  clipIndex: number;
  renderState: RenderState;
  updateRenderState: (clipKey: string, patch: Partial<RenderState>) => void;
  onCollapse: () => void;
  onSchedule: (clipKey: string) => void;
  onRender: (clip: Clip, clipKey: string) => Promise<void>;
  onRenderCancel: (clipKey: string) => void;
  onCropChange: (clipKey: string) => (gameplay: CropBox, avatar: CropBox) => void;
  onRefreshCrop: (clip: Clip, clipKey: string) => Promise<void>;
  cropCanvasKey: number;
  cropSegmentPaths: Record<string, string>;
  cropRefreshing: Record<string, boolean>;
  sourcePath: string;
  originalSource: string | null;
  nvencAvailable: boolean;
  videoDimensions: { w: number; h: number };
  hasImprovedTranscript: boolean;
  improveProgress: { value: number; label: string } | null;
  improveModel: Record<string, string>;
  onImproveSubtitles: (clip: Clip, clipKey: string) => Promise<void>;
  onImproveModelChange: (clipKey: string, model: string) => void;
  projectId: string;
  onClipUpdate: (clipKey: string, updated: Clip) => void;
  onSaveTiming: (clipIndex: number, patch: Partial<Clip>) => void;
}

export function ClipDetail({
  clip,
  clipKey,
  clipIndex,
  renderState: state,
  updateRenderState,
  onCollapse,
  onSchedule,
  onRender,
  onRenderCancel,
  onCropChange,
  onRefreshCrop,
  cropCanvasKey,
  cropSegmentPaths,
  cropRefreshing,
  sourcePath,
  originalSource,
  nvencAvailable,
  videoDimensions,
  hasImprovedTranscript,
  improveProgress,
  improveModel,
  onImproveModelChange,
  onImproveSubtitles,
  projectId,
  onClipUpdate,
  onSaveTiming,
}: ClipDetailProps) {
  const handleLayoutChange = (
    mode: string,
    cropBoxes: { gameplay: CropBox; avatar: CropBox },
  ) => {
    updateRenderState(clipKey, { layoutMode: mode, cropBoxes } as Partial<RenderState>);
  };

  const handleStyleUpdate = (patch: Record<string, unknown>) => {
    updateRenderState(clipKey, patch as Partial<RenderState>);
  };

  return (
    <div
      className="col-span-full glass-card p-4 animate-expand"
      role="listitem"
      style={{ animation: "slideDown 0.3s ease-out" }}
    >
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="font-semibold text-[var(--ctp-text)]">
              {clip.title || "Untitled Clip"}
            </h3>
            <p className="text-xs text-[var(--ctp-subtext)]">
              {formatTime(clip.start)} - {formatTime(clip.end)} (
              {(clip.end - clip.start).toFixed(1)}s)
            </p>
          </div>
          <BloomIndicator score={clip.virality_score || 0} size="md" />
        </div>

        {/* Unified content: Clip Info + Preview/Crop + Subtitles + Render */}
        <div className="space-y-4">
          <ClipSectionInfo
            clip={clip}
            clipKey={clipKey}
            clipIndex={clipIndex}
            originalSource={originalSource}
            onClipUpdate={onClipUpdate}
            onSaveTiming={onSaveTiming}
          />

          <ClipSectionPreviewCrop
            layoutMode={state.layoutMode}
            cropBoxes={state.cropBoxes}
            sourcePath={sourcePath}
            originalSource={originalSource}
            clipStart={clip.start}
            clipTitle={clip.title}
            segmentPath={cropSegmentPaths[clipKey]}
            refreshing={!!cropRefreshing[clipKey]}
            canvasKey={cropCanvasKey}
            videoDimensions={videoDimensions}
            onCropChange={onCropChange(clipKey)}
            onRefresh={() => onRefreshCrop(clip, clipKey)}
            onLayoutChange={handleLayoutChange}
          />

          <ClipSectionSubtitles
            hasImprovedTranscript={hasImprovedTranscript}
            progress={improveProgress}
            model={improveModel[clipKey] || "large-v3"}
            onModelChange={(model) => onImproveModelChange(clipKey, model)}
            onImprove={() => onImproveSubtitles(clip, clipKey)}
            fontName={state.fontName}
            fontColor={state.fontColor}
            highlightColor={state.highlightColor}
            outlineColor={state.outlineColor}
            outlineWidth={state.outlineWidth}
            fontSize={state.fontSize}
            captionStyle={state.captionStyle}
            animationSpeed={state.animationSpeed || 'normal'}
            qualityPreset={state.qualityPreset}
            stylePreset={state.stylePreset || null}
            nvencAvailable={nvencAvailable}
            onUpdate={handleStyleUpdate}
          />

          <ClipSectionRender
            progress={state.progress}
            downloadUrl={state.downloadUrl}
            error={state.error}
            isCancelling={state.isCancelling}
            layoutMode={state.layoutMode}
            onRender={() => onRender(clip, clipKey)}
            onCancel={() => onRenderCancel(clipKey)}
            onLayoutChange={handleLayoutChange}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t border-[var(--ctp-overlay)]">
          <Button onClick={onCollapse} variant="secondary" size="sm">
            Collapse
          </Button>
          <Button
            onClick={() => onSchedule(clipKey)}
            variant="secondary"
            size="sm"
          >
            Schedule
          </Button>
          <Link
            to={`/video/${projectId}/timeline/${clip.id || clip.index}`}
            className="btn-secondary text-sm"
          >
            Timeline Editor
          </Link>
        </div>
      </div>
    </div>
  );
}
