import { useState, useEffect } from 'react';
import { CropCanvas, centeredCropBox9x16 } from "../../components/CropCanvas";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/ToggleGroup";
import { frameUrl } from "../../api";
import { cropFrame } from "./utils";
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

  const [croppedAvatarUrl, setCroppedAvatarUrl] = useState<string | null>(null);

  // Generate cropped avatar when crop box or frame changes
  useEffect(() => {
    const generateCroppedAvatar = async () => {
      const fullFrameUrl = frameUrl(src, frameTime);
      try {
        // For camera_only mode: use natural aspect ratio, scale to fill 9:16
        // For stacked mode: force 9:16 aspect ratio on the avatar crop
        const forceAspect = layoutMode === 'camera_only' ? undefined : 9 / 16;
        const avatarPct = {
          x: ((cropBoxes.avatar.x / videoDimensions.w) * 100).toFixed(1),
          y: ((cropBoxes.avatar.y / videoDimensions.h) * 100).toFixed(1),
          w: ((cropBoxes.avatar.w / videoDimensions.w) * 100).toFixed(1),
          h: ((cropBoxes.avatar.h / videoDimensions.h) * 100).toFixed(1),
        };
        console.log('[avatar crop]', cropBoxes.avatar, 'as %:', avatarPct);
        const cropped = await cropFrame(
          fullFrameUrl,
          cropBoxes.avatar,
          videoDimensions,
          270,
          forceAspect,
        );
        setCroppedAvatarUrl(cropped);
      } catch (err) {
        console.error('Failed to generate cropped avatar:', err);
        setCroppedAvatarUrl(null);
      }
    };

    generateCroppedAvatar();
  }, [cropBoxes.avatar, src, frameTime, videoDimensions, layoutMode]);

  // Calculate the crop region as a percentage of the source video
  const avatarCropPct = {
    left: (cropBoxes.avatar.x / videoDimensions.w) * 100,
    top: (cropBoxes.avatar.y / videoDimensions.h) * 100,
    width: (cropBoxes.avatar.w / videoDimensions.w) * 100,
    height: (cropBoxes.avatar.h / videoDimensions.h) * 100,
    right: 0,
    bottom: 0,
  };
  avatarCropPct.right = 100 - avatarCropPct.left - avatarCropPct.width;
  avatarCropPct.bottom = 100 - avatarCropPct.top - avatarCropPct.height;

  const gameplayCropPct = {
    left: (cropBoxes.gameplay.x / videoDimensions.w) * 100,
    top: (cropBoxes.gameplay.y / videoDimensions.h) * 100,
    width: (cropBoxes.gameplay.w / videoDimensions.w) * 100,
    height: (cropBoxes.gameplay.h / videoDimensions.h) * 100,
    right: 0,
    bottom: 0,
  };
  gameplayCropPct.right = 100 - gameplayCropPct.left - gameplayCropPct.width;
  gameplayCropPct.bottom = 100 - gameplayCropPct.top - gameplayCropPct.height;

  // Calculate position to center the crop region in the container
  const avatarObjPos = `${avatarCropPct.left + avatarCropPct.width / 2}% ${avatarCropPct.top + avatarCropPct.height / 2}%`;
  const gameplayObjPos = `${gameplayCropPct.left + gameplayCropPct.width / 2}% ${gameplayCropPct.top + gameplayCropPct.height / 2}%`;

  return (
    <div className="flex flex-row gap-4">
      {/* 9:16 Preview - fixed width, no scroll */}
      <div
        className="flex-shrink-0 flex flex-col items-center"
        style={{ width: 270 }}
      >
        <div
          className="relative overflow-hidden rounded-lg border-2 border-[var(--momiji-sakura)] shadow-xl"
          style={{
            width: "100%",
            aspectRatio: "9/16",
            background: "#181825",
          }}
        >
          {layoutMode === "camera_only" ? (
            <div className="absolute inset-0 overflow-hidden bg-[#181825]">
              <img
                src={croppedAvatarUrl || frameUrl(src, frameTime)}
                alt="camera preview"
                className="w-full h-full object-cover"
              />
            </div>
          ) : layoutMode === "gameplay_only" ? (
            <div className="absolute inset-0 overflow-hidden bg-[#181825]">
              <img
                src={frameUrl(src, frameTime)}
                alt="gameplay preview"
                className="w-full h-full"
                style={{
                  objectFit: "cover",
                  objectPosition: gameplayObjPos,
                }}
              />
            </div>
          ) : (
            <>
              {/* Avatar preview (top half) - use cropped image */}
              <div className="absolute left-0 top-0 w-full h-1/2 overflow-hidden bg-[#181825]">
                <img
                  src={croppedAvatarUrl || frameUrl(src, frameTime)}
                  alt="avatar preview"
                  className="w-full h-full object-cover"
                />
              </div>
              {/* Gameplay preview (bottom half) */}
              <div className="absolute left-0 bottom-0 w-full h-1/2 overflow-hidden bg-[#181825]">
                <img
                  src={frameUrl(src, frameTime)}
                  alt="gameplay preview"
                  className="w-full h-full"
                  style={{
                    objectFit: 'cover',
                    objectPosition: gameplayObjPos,
                  }}
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
      </div>

      {/* Crop canvas and controls - flexible width, no scroll */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
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

        {/* Layout toggle group + refresh */}
        <div className="flex items-center gap-3">
          <ToggleGroup
            type="single"
            value={layoutMode}
            onValueChange={(mode) => {
              if (mode === "stacked") {
                onLayoutChange("stacked", {
                  gameplay: { x: 0, y: 0, w: Math.round(videoDimensions.w * 0.70), h: videoDimensions.h },
                  avatar: { x: Math.round(videoDimensions.w * 0.72), y: Math.round(videoDimensions.h * 0.55), w: Math.round(videoDimensions.w * 0.27), h: Math.round(videoDimensions.h * 0.43) },
                });
              } else if (mode === "camera_only") {
                // For camera_only: use a wider crop that captures typical VTuber avatar region
                // Then scale to fill 9:16 output (with cover behavior)
                onLayoutChange("camera_only", {
                  gameplay: { x: 0, y: 0, w: Math.round(videoDimensions.w * 0.60), h: videoDimensions.h },
                  avatar: { x: Math.round(videoDimensions.w * 0.55), y: 0, w: Math.round(videoDimensions.w * 0.45), h: videoDimensions.h },
                });
              } else {
                // gameplay_only: centered 9:16 crop
                const box = centeredCropBox9x16(videoDimensions.w, videoDimensions.h);
                onLayoutChange("gameplay_only", { gameplay: box, avatar: box });
              }
            }}
          >
            <ToggleGroupItem value="stacked" label="Stacked" />
            <ToggleGroupItem value="camera_only" label="Camera" />
            <ToggleGroupItem value="gameplay_only" label="Game" />
          </ToggleGroup>
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
            {refreshing ? "Downloading..." : "Refresh"}
          </button>
        </div>
      </div>
    </div>
  );
}
