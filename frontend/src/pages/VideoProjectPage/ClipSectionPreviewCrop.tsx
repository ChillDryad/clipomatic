import { CropCanvas, centeredCropBox9x16 } from "../../components/CropCanvas";
import { frameUrl } from "../../api";
import type { CropBox } from "../../types";

interface ClipSectionPreviewCropProps {
  layoutMode: string;
  cropBoxes: { gameplay: CropBox; avatar: CropBox };
  sourcePath: string;
  originalSource: string | null;
  clipStart: number;
  clipTitle: string;
  segmentPath?: string;
  refreshing: boolean;
  canvasKey: number;
  videoDimensions: { w: number; h: number };
  onCropChange: (gameplay: CropBox, avatar: CropBox) => void;
  onRefresh: () => void;
  onLayoutChange: (
    mode: string,
    cropBoxes: { gameplay: CropBox; avatar: CropBox },
  ) => void;
}

export function ClipSectionPreviewCrop({
  layoutMode,
  cropBoxes,
  sourcePath,
  originalSource,
  clipStart,
  clipTitle,
  segmentPath,
  refreshing,
  canvasKey,
  videoDimensions,
  onCropChange,
  onRefresh,
  onLayoutChange,
}: ClipSectionPreviewCropProps) {
  const src = originalSource || sourcePath;
  const frameSource = segmentPath || originalSource || sourcePath;
  const frameAt = segmentPath ? 0 : clipStart;
  const frameTime = clipStart + 2;

  // Calculate crop positions as percentages for object-position
  const avatarPos = `${((cropBoxes.avatar.x + cropBoxes.avatar.w / 2) / videoDimensions.w) * 100}% ${((cropBoxes.avatar.y + cropBoxes.avatar.h / 2) / videoDimensions.h) * 100}%`;
  const gameplayPos = `${((cropBoxes.gameplay.x + cropBoxes.gameplay.w / 2) / videoDimensions.w) * 100}% ${((cropBoxes.gameplay.y + cropBoxes.gameplay.h / 2) / videoDimensions.h) * 100}%`;

  // Calculate clip-path for proper cropping (shows only the selected region)
  const avatarClip = `inset(${(cropBoxes.avatar.y / videoDimensions.h) * 100}% ${(100 - (cropBoxes.avatar.x + cropBoxes.avatar.w) / videoDimensions.w * 100)}% ${(100 - (cropBoxes.avatar.y + cropBoxes.avatar.h) / videoDimensions.h * 100)}% ${(cropBoxes.avatar.x / videoDimensions.w) * 100}%)`;
  const gameplayClip = `inset(${(cropBoxes.gameplay.y / videoDimensions.h) * 100}% ${(100 - (cropBoxes.gameplay.x + cropBoxes.gameplay.w) / videoDimensions.w * 100)}% ${(100 - (cropBoxes.gameplay.y + cropBoxes.gameplay.h) / videoDimensions.h * 100)}% ${(cropBoxes.gameplay.x / videoDimensions.w) * 100}%)`;

  return (
    <div className="space-y-3">
      {/* 9:16 Preview */}
      <div
        className="relative mx-auto overflow-hidden rounded-lg border-2 border-[var(--momiji-sakura)] shadow-xl"
        style={{
          width: "100%",
          maxWidth: 270,
          aspectRatio: "9/16",
          background: "#181825",
        }}
      >
        {layoutMode === "camera_only" ? (
          <div className="absolute inset-0 overflow-hidden bg-[#181825]">
            <img
              src={frameUrl(src, frameTime)}
              alt="camera preview"
              className="w-full h-full"
              style={{ objectFit: "cover", objectPosition: avatarPos, clipPath: avatarClip }}
            />
          </div>
        ) : layoutMode === "gameplay_only" ? (
          <div className="absolute inset-0 overflow-hidden bg-[#181825]">
            <img
              src={frameUrl(src, frameTime)}
              alt="gameplay preview"
              className="w-full h-full"
              style={{ objectFit: "cover", objectPosition: gameplayPos, clipPath: gameplayClip }}
            />
          </div>
        ) : (
          <>
            <div className="absolute left-0 top-0 w-full h-1/2 overflow-hidden bg-[#181825]">
              <img
                src={frameUrl(src, frameTime)}
                alt="avatar preview"
                className="w-full h-full"
                style={{ objectFit: "cover", objectPosition: avatarPos, clipPath: avatarClip }}
              />
            </div>
            <div className="absolute left-0 bottom-0 w-full h-1/2 overflow-hidden bg-[#181825]">
              <img
                src={frameUrl(src, frameTime)}
                alt="gameplay preview"
                className="w-full h-full"
                style={{ objectFit: "cover", objectPosition: gameplayPos, clipPath: gameplayClip }}
              />
            </div>
          </>
        )}
        <div
          className="absolute left-0 right-0 bottom-0 flex items-center justify-center px-3 py-2 pointer-events-none"
          style={{ background: "rgba(0,0,0,0.6)", height: "12%" }}
        >
          <span className="text-[10px] text-white font-medium truncate">
            {clipTitle}
          </span>
        </div>
      </div>

      {/* Crop canvas (interactive) */}
      <CropCanvas
        key={canvasKey}
        frameUrl={frameUrl(frameSource, frameAt)}
        videoDimensions={videoDimensions}
        onChange={onCropChange}
        initialGameplay={cropBoxes.gameplay}
        initialAvatar={cropBoxes.avatar}
        layoutMode={layoutMode}
        title={clipTitle}
      />

      {/* Layout quick-select + refresh */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="layout"
            value="stacked"
            checked={layoutMode === "stacked"}
            onChange={() =>
              onLayoutChange("stacked", {
                gameplay: { x: 0, y: 0, w: Math.round(videoDimensions.w * 0.70), h: videoDimensions.h },
                avatar: { x: Math.round(videoDimensions.w * 0.72), y: Math.round(videoDimensions.h * 0.55), w: Math.round(videoDimensions.w * 0.27), h: Math.round(videoDimensions.h * 0.43) },
              })
            }
            className="accent-[var(--ctp-mauve)]"
          />
          <span className="text-xs text-[var(--ctp-text)]">Stacked</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="layout"
            value="camera_only"
            checked={layoutMode === "camera_only"}
            onChange={() => {
              const box = centeredCropBox9x16(videoDimensions.w, videoDimensions.h);
              onLayoutChange("camera_only", { gameplay: box, avatar: box });
            }}
            className="accent-[var(--ctp-mauve)]"
          />
          <span className="text-xs text-[var(--ctp-text)]">Camera Only</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="layout"
            value="gameplay_only"
            checked={layoutMode === "gameplay_only"}
            onChange={() => {
              const box = centeredCropBox9x16(videoDimensions.w, videoDimensions.h);
              onLayoutChange("gameplay_only", { gameplay: box, avatar: box });
            }}
            className="accent-[var(--ctp-mauve)]"
          />
          <span className="text-xs text-[var(--ctp-text)]">Game Only</span>
        </label>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="ml-auto text-xs text-[var(--ctp-blue)] hover:text-[var(--ctp-text)] flex items-center gap-1 disabled:opacity-50"
          title="Download segment and refresh crop preview"
        >
          {refreshing ? (
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {refreshing ? "Downloading…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
