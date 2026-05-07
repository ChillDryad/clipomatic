import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { frameUrl, thumbnailUrl, uploadProjectThumbnail, autoGenerateProjectThumbnail, deleteProjectThumbnail } from "../../api";
import { formatDate, formatDuration } from "../../utils/format";
import { getRoleBadgeClass } from "../../utils/roles";
import { RetranscribePanel } from "./RetranscribePanel";
import type { VideoProject, TeamMember } from "./types";
import { useRef, useState, useCallback } from "react";

interface ProjectHeaderProps {
  project: VideoProject;
  clipsCount: number;
  projectId: string;
  members: TeamMember[];
  selectedClipIds: Set<string>;
  allClipKeys: string[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteProject: () => void;
  selectedWhisperModel: string;
  onWhisperModelChange: (model: string) => void;
  onReTranscribe: () => void;
  transcribing: boolean;
  transcribeProgress: { value: number; label: string } | null;
  onRedetectClips: () => void;
  redetecting: boolean;
  redetectProgress: { value: number; label: string } | null;
  thumbnailPath?: string | null;
  onThumbnailChange?: (path: string | null) => void;
}

const statusBadgeClass = (status: string) => {
  if (status === "complete")
    return "bg-[var(--ctp-green)]/20 text-[var(--ctp-green)] border-[var(--ctp-green)]/30";
  if (status === "processing")
    return "bg-[var(--ctp-blue)]/20 text-[var(--ctp-blue)] border-[var(--ctp-blue)]/30";
  if (status === "failed")
    return "bg-[var(--ctp-red)]/20 text-[var(--ctp-red)] border-[var(--ctp-red)]/30";
  return "bg-[var(--ctp-overlay)]/20 text-[var(--ctp-subtext)] border-[var(--ctp-overlay)]/30";
};

export function ProjectHeader({
  project,
  clipsCount,
  projectId,
  members,
  selectedClipIds,
  allClipKeys,
  onSelectAll,
  onClearSelection,
  onDeleteProject,
  selectedWhisperModel,
  onWhisperModelChange,
  onReTranscribe,
  transcribing,
  transcribeProgress,
  onRedetectClips,
  redetecting,
  redetectProgress,
  thumbnailPath,
  onThumbnailChange,
}: ProjectHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const hasCustomThumbnail = !!thumbnailPath;

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadProjectThumbnail(projectId, file);
      onThumbnailChange?.(result.thumbnail_path);
    } catch (err) {
      console.error("Thumbnail upload failed:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [projectId, onThumbnailChange]);

  const handleAutoGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await autoGenerateProjectThumbnail(projectId);
      onThumbnailChange?.(result.thumbnail_path);
    } catch (err) {
      console.error("Auto-generate thumbnail failed:", err);
    } finally {
      setGenerating(false);
    }
  }, [projectId, onThumbnailChange]);

  const handleDelete = useCallback(async () => {
    try {
      await deleteProjectThumbnail(projectId);
      onThumbnailChange?.(null);
    } catch (err) {
      console.error("Delete thumbnail failed:", err);
    }
  }, [projectId, onThumbnailChange]);
  return (
    <div className="glass-card p-5 space-y-4">
      {/* Top section: thumbnail + title + actions */}
      <div className="flex gap-4">
        <div className="w-48 h-28 rounded-lg bg-[var(--ctp-surface-1)] overflow-hidden flex-shrink-0 relative group">
          <img
            src={hasCustomThumbnail ? thumbnailUrl(projectId) : frameUrl(project.original_source || project.source_path, project.duration ? project.duration * 0.5 : 2)}
            alt="Video thumbnail"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          {project.duration && (
            <span className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded">
              {formatDuration(project.duration)}
            </span>
          )}

          {/* Thumbnail overlay controls */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="p-1.5 bg-white/90 rounded text-xs text-black hover:bg-white transition-colors disabled:opacity-50"
              title="Upload thumbnail"
            >
              {uploading ? "…" : "📷"}
            </button>
            <button
              onClick={handleAutoGenerate}
              disabled={generating}
              className="p-1.5 bg-white/90 rounded text-xs text-black hover:bg-white transition-colors disabled:opacity-50"
              title="Auto-generate thumbnail"
            >
              {generating ? "…" : "✨"}
            </button>
            {hasCustomThumbnail && (
              <button
                onClick={handleDelete}
                className="p-1.5 bg-red-500/90 rounded text-xs text-white hover:bg-red-500 transition-colors"
                title="Remove thumbnail"
              >
                ✕
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        <div className="flex-1">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-[var(--ctp-text)]">
                {project.original_filename}
              </h1>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="text-sm text-[var(--ctp-subtext)]">
                  {clipsCount} clips detected
                </span>
                <span className="text-xs text-[var(--ctp-subtext)]">·</span>
                <span className="text-sm text-[var(--ctp-subtext)]">
                  Created: {formatDate(project.created_at)}
                </span>
                {project.original_source && (
                  <>
                    <span className="text-xs text-[var(--ctp-subtext)]">·</span>
                    <a
                      href={project.original_source}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[var(--ctp-blue)] hover:underline"
                    >
                      Source URL
                    </a>
                  </>
                )}
              </div>
            </div>
            <span
              className={`text-xs px-2 py-1 rounded font-medium border ${statusBadgeClass(project.status)}`}
            >
              {project.status}
            </span>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            <Link
              to={`/pipeline?restore=${project.id}`}
              className="btn-secondary text-sm py-1"
            >
              <svg
                className="w-4 h-4 inline mr-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Re-run Pipeline
            </Link>
            <Link
              to={`/video/${projectId}/timeline`}
              className="btn-secondary text-sm py-1"
            >
              <svg
                className="w-4 h-4 inline mr-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Timeline Editor
            </Link>
            {project.status === "complete" && (
              <>
                <Button variant="primary" size="sm">
                  <svg
                    className="w-4 h-4 inline mr-1"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  Export All Clips
                </Button>
                <button
                  onClick={onSelectAll}
                  className="btn-secondary text-sm py-1"
                >
                  Select All
                </button>
              </>
            )}
            {selectedClipIds.size > 0 && (
              <button
                onClick={onClearSelection}
                className="btn-secondary text-sm py-1"
              >
                Clear Selection
              </button>
            )}
          </div>

          {project.team && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs px-2 py-1 rounded bg-[var(--ctp-mauve)]/20 text-[var(--ctp-mauve)] border border-[var(--ctp-mauve)]/30">
                Team: {project.team.name}
              </span>
              {members.length > 0 && (
                <span className="text-xs text-[var(--ctp-subtext)]">
                  {members.length} member{members.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Separator */}
      <hr className="border-[var(--ctp-surface-1)]" />

      {/* Project Info + Quick Actions row */}
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <h4 className="text-xs font-semibold text-[var(--ctp-subtext)] mb-2 uppercase tracking-wider">
            Project Info
          </h4>
          <dl className="space-y-1.5 text-xs">
            <div className="flex gap-4">
              <dt className="text-[var(--ctp-subtext)] w-16">Owner</dt>
              <dd className="text-[var(--ctp-text)]">
                {project.owner?.display_name ||
                  project.owner?.email ||
                  "Unknown"}
              </dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-[var(--ctp-subtext)] w-16">Created</dt>
              <dd className="text-[var(--ctp-text)]">
                {formatDate(project.created_at)}
              </dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-[var(--ctp-subtext)] w-16">Updated</dt>
              <dd className="text-[var(--ctp-text)]">
                {formatDate(project.updated_at)}
              </dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-[var(--ctp-subtext)] w-16">Duration</dt>
              <dd className="text-[var(--ctp-text)]">
                {formatDuration(project.duration)}
              </dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-[var(--ctp-subtext)] w-16">Status</dt>
              <dd className="text-[var(--ctp-text)] capitalize">
                {project.status}
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-[var(--ctp-subtext)] mb-2 uppercase tracking-wider">
            Quick Actions
          </h4>
          <div className="flex flex-wrap gap-2">
            <RetranscribePanel
              selectedModel={selectedWhisperModel}
              onModelChange={onWhisperModelChange}
              onReTranscribe={onReTranscribe}
              transcribing={transcribing}
              progress={transcribeProgress}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={onRedetectClips}
              disabled={redetecting}
            >
              {redetecting ? (
                <span className="inline-flex items-center gap-1.5">
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Detecting…
                </span>
              ) : (
                <>
                  <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  Redetect Clips
                </>
              )}
            </Button>
            {redetectProgress && (
              <div className="w-full">
                <ProgressBar progress={redetectProgress.value} label={redetectProgress.label} />
              </div>
            )}
            <Button variant="secondary" size="sm">
              Share Project
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={onDeleteProject}
            >
              Delete Project
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
