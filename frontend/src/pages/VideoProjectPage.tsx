import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import {
  frameUrl,
  updateClip,
  renderClip,
  downloadSegment,
  getAbortController,
  cancelOperation,
  getVideoDimensions,
  transcribeSegment,
  type PlatformAccount,
} from "../api";
import type { Clip, CropBox, Transcript } from "../types";
import { formatDate, formatDuration, formatTime } from "../utils/format";
import { getRoleBadgeClass } from "../utils/roles";
import { CropCanvas } from "../components/CropCanvas";
import { ProgressBar } from "../components/ui/ProgressBar";
import { ScheduleModal } from "../components/ScheduleModal";
import { PlatformAccounts } from "../components/PlatformAccounts";

interface VideoProject {
  id: string;
  owner_id: string;
  team_id: string | null;
  source_path: string;
  original_source: string | null; // Original URL (YouTube/Twitch/Kick)
  original_filename: string;
  duration: number | null;
  status: "pending" | "processing" | "complete" | "failed";
  created_at: number;
  updated_at: number;
  owner?: { id: string; display_name: string | null; email: string };
  team?: { id: string; name: string } | null;
  clips?: Clip[];
}

interface TeamMember {
  id: string;
  user_id: string;
  user: { id: string; display_name: string | null; email: string };
  role: "owner" | "admin" | "editor" | "viewer";
}

export function VideoProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(
    new Set(),
  );
  const [showBatchSchedule, setShowBatchSchedule] = useState(false);
  const [batchRendering, setBatchRendering] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    value: number;
    label: string;
  } | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login", { replace: true });
      return;
    }
    if (!projectId) return;
    loadProject(projectId);
  }, [projectId, isAuthenticated]);

  const loadProject = async (id: string) => {
    setLoading(true);
    setError(null);

    try {
      const [projectRes, clipsRes] = await Promise.all([
        fetch(`/api/projects/${id}`, { credentials: "include" }),
        fetch(`/api/projects/${id}/clips`, { credentials: "include" }),
      ]);

      if (projectRes.status === 403 || projectRes.status === 404) {
        setError("Project not found or access denied");
        setLoading(false);
        return;
      }

      if (!projectRes.ok) throw new Error(await projectRes.text());
      const projectData = await projectRes.json();
      setProject(projectData);

      if (clipsRes.ok) {
        const clipsData = await clipsRes.json();
        const rawClips = clipsData.clips || clipsData || [];
        console.log("Loaded clips:", rawClips);
        // Normalize clip data - backend uses start_time/end_time, frontend expects start/end
        // Generate stable IDs based on start/end time if not provided
        const normalizedClips = rawClips.map((clip: any) => ({
          ...clip,
          start: clip.start ?? clip.start_time,
          end: clip.end ?? clip.end_time,
          id:
            clip.id ||
            `clip-${clip.start ?? clip.start_time}-${clip.end ?? clip.end_time}`,
        }));
        console.log("Normalized clips:", normalizedClips);
        setClips(normalizedClips);
      }

      if (projectData.team_id) {
        const membersRes = await fetch(
          `/api/teams/${projectData.team_id}/members`,
          { credentials: "include" },
        );
        if (membersRes.ok) {
          const membersData = await membersRes.json();
          setMembers(membersData.members || []);
        }
      }
    } catch (err) {
      console.error("Failed to load project:", err);
      setError(err instanceof Error ? err.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  };

  const toggleClip = (clipId: string) => {
    setSelectedClipIds((prev) => {
      const next = new Set(prev);
      if (next.has(clipId)) next.delete(clipId);
      else next.add(clipId);
      return next;
    });
  };

  const handleBatchRender = async () => {
    setBatchRendering(true);
    setBatchProgress({ value: 0, label: "Starting batch render..." });

    const selectedClips = clips.filter((c) =>
      selectedClipIds.has(c.id || `idx-${c.index}`),
    );

    for (let i = 0; i < selectedClips.length; i++) {
      const clip = selectedClips[i];
      setBatchProgress({
        value: (i / selectedClips.length) * 100,
        label: `Rendering ${i + 1}/${selectedClips.length}: ${clip.title}`,
      });

      // TODO: Implement batch render logic
      // For now, just mark progress
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    setBatchRendering(false);
    setBatchProgress(null);
    setSelectedClipIds(new Set());
  };

  if (loading) {
    return (
      <div
        className="text-[var(--ctp-subtext)] p-8 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="inline-flex items-center gap-2">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          Loading project...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-6 text-center">
        <p className="text-[var(--ctp-red)] mb-4">{error}</p>
        <Button onClick={() => navigate("/dashboard")} variant="primary">
          Go to Dashboard
        </Button>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="glass-card p-6 text-center">
        <p className="text-[var(--ctp-subtext)]">Project not found</p>
        <Button
          onClick={() => navigate("/dashboard")}
          variant="primary"
          className="mt-4"
        >
          Go to Dashboard
        </Button>
      </div>
    );
  }

  const sortedClips = [...clips].sort(
    (a, b) => b.virality_score - a.virality_score,
  );

  const handleClipUpdate = (clipId: string, updated: Clip) => {
    setClips((prev) =>
      prev.map((clip) => {
        const key = clip.id ? clip.id : `clip-${clip.start}-${clip.end}`;
        return key === clipId ? updated : clip;
      }),
    );
  };

  return (
    <div className="space-y-6">
      {/* Project Header */}
      <div className="glass-card p-5">
        <div className="flex gap-4">
          <div className="w-48 h-28 rounded-lg bg-[var(--ctp-surface-1)] overflow-hidden flex-shrink-0 relative">
            <img
              src={frameUrl(project.original_source || project.source_path, 2)}
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
          </div>

          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-bold text-[var(--ctp-text)]">
                  {project.original_filename}
                </h1>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <span className="text-sm text-[var(--ctp-subtext)]">
                    {clips.length} clips detected
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
                className={`text-xs px-2 py-1 rounded font-medium border ${
                  project.status === "complete"
                    ? "bg-[var(--ctp-green)]/20 text-[var(--ctp-green)] border-[var(--ctp-green)]/30"
                    : project.status === "processing"
                      ? "bg-[var(--ctp-blue)]/20 text-[var(--ctp-blue)] border-[var(--ctp-blue)]/30"
                      : project.status === "failed"
                        ? "bg-[var(--ctp-red)]/20 text-[var(--ctp-red)] border-[var(--ctp-red)]/30"
                        : "bg-[var(--ctp-overlay)]/20 text-[var(--ctp-subtext)] border-[var(--ctp-overlay)]/30"
                }`}
              >
                {project.status}
              </span>
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              <Link
                to={`/pipeline?restore=${encodeURIComponent(project.source_path)}`}
                className="btn-secondary text-sm py-1"
              >
                <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Re-run Pipeline
              </Link>
              <Link
                to={`/video/${projectId}/timeline`}
                className="btn-secondary text-sm py-1"
              >
                <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Timeline Editor
              </Link>
              {project.status === "complete" && (
                <>
                  <Button variant="primary" size="sm">
                    <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Export All Clips
                  </Button>
                  <button
                    onClick={() => {
                      setSelectedClipIds(new Set(clips.map(c => c.id || `clip-${c.start}-${c.end}`)));
                    }}
                    className="btn-secondary text-sm py-1"
                  >
                    Select All
                  </button>
                </>
              )}
              {selectedClipIds.size > 0 && (
                <button
                  onClick={() => setSelectedClipIds(new Set())}
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
      </div>

      {/* Clips Grid */}
      <div>
        <h2 className="text-base font-semibold text-[var(--ctp-text)] mb-4">
          Detected Clips ({clips.length})
        </h2>

        {clips.length === 0 ? (
          <div className="glass-card p-6 text-center">
            <p className="text-[var(--ctp-subtext)] mb-3">
              No clips detected yet
            </p>
            <Link
              to={`/pipeline?restore=${encodeURIComponent(project.source_path)}`}
              className="btn-primary"
            >
              Run Highlight Detection
            </Link>
          </div>
        ) : (
          <>
            <ClipListVirtual
              clips={sortedClips}
              selectedIds={selectedClipIds}
              onToggle={toggleClip}
              projectId={project.id}
              onClipUpdate={handleClipUpdate}
              sourcePath={project.source_path}
              originalSource={project.original_source}
            />

            {selectedClipIds.size > 0 && (
              <div className="glass-card p-4 flex gap-3 items-center sticky bottom-4">
                <span className="text-[var(--ctp-subtext)]">
                  {selectedClipIds.size} selected
                </span>
                <Button
                  variant="primary"
                  onClick={handleBatchRender}
                  disabled={batchRendering}
                >
                  {batchRendering ? "Rendering..." : "Render Selected"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowBatchSchedule(true)}
                >
                  Schedule Posts
                </Button>
                {batchProgress && (
                  <div className="flex-1">
                    <ProgressBar
                      progress={batchProgress.value}
                      label={batchProgress.label}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Sidebar */}
      <div className="space-y-4">
          {members.length > 0 && (
            <div className="glass-card p-4">
              <h3 className="text-sm font-semibold text-[var(--ctp-text)] mb-3">
                Team Members
              </h3>
              <div className="space-y-2">
                {members.map((member) => {
                  const userName =
                    member.user?.display_name ||
                    member.user?.email ||
                    "Unknown";
                  const userInitial = userName[0]?.toUpperCase() || "?";
                  return (
                    <div
                      key={member.id}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[var(--ctp-mauve)]/20 flex items-center justify-center text-xs font-medium text-[var(--ctp-mauve)]">
                          {userInitial}
                        </div>
                        <div>
                          <p className="text-xs text-[var(--ctp-text)]">
                            {userName}
                          </p>
                          {member.user?.email &&
                            member.user?.email !==
                              member.user?.display_name && (
                              <p className="text-[10px] text-[var(--ctp-subtext)]">
                                {member.user.email}
                              </p>
                            )}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${getRoleBadgeClass(member.role)}`}
                      >
                        {member.role}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-[var(--ctp-text)] mb-3">
              Project Info
            </h3>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-[var(--ctp-subtext)]">Owner</dt>
                <dd className="text-[var(--ctp-text)]">
                  {project.owner?.display_name ||
                    project.owner?.email ||
                    "Unknown"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ctp-subtext)]">Created</dt>
                <dd className="text-[var(--ctp-text)]">
                  {formatDate(project.created_at)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ctp-subtext)]">Updated</dt>
                <dd className="text-[var(--ctp-text)]">
                  {formatDate(project.updated_at)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ctp-subtext)]">Duration</dt>
                <dd className="text-[var(--ctp-text)]">
                  {formatDuration(project.duration)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ctp-subtext)]">Status</dt>
                <dd className="text-[var(--ctp-text)] capitalize">
                  {project.status}
                </dd>
              </div>
            </dl>
          </div>

          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-[var(--ctp-text)] mb-3">
              Quick Actions
            </h3>
            <div className="space-y-2">
              <Link
                to={`/pipeline?restore=${encodeURIComponent(project.source_path)}`}
                className="block btn-secondary text-sm text-center"
              >
                Re-transcribe
              </Link>
              <Button variant="secondary" size="sm" className="w-full">
                Share Project
              </Button>
              <Button variant="danger" size="sm" className="w-full">
                Delete Project
              </Button>
            </div>
          </div>
        </div>

      {showBatchSchedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="glass-card p-6 w-full max-w-md shadow-2xl max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[var(--ctp-text)]">
                Schedule Selected Clips
              </h3>
              <button
                onClick={() => setShowBatchSchedule(false)}
                className="text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)]"
              >
                ×
              </button>
            </div>
            <p className="text-sm text-[var(--ctp-subtext)] mb-4">
              Batch scheduling coming soon. For now, please schedule clips
              individually from each clip card.
            </p>
            <Button
              onClick={() => setShowBatchSchedule(false)}
              variant="secondary"
              className="w-full"
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Virtualized clip list component
interface ClipListVirtualProps {
  clips: Clip[];
  selectedIds: Set<string>;
  onToggle: (clipId: string) => void;
  projectId: string;
  onClipUpdate: (clipId: string, updated: Clip) => void;
  sourcePath: string;
  originalSource: string | null; // Original URL (YouTube/Twitch/Kick)
}

const getViralityBadgeColor = (score: number): string => {
  if (score >= 80)
    return "bg-[var(--ctp-green)]/20 text-[var(--ctp-green)] border-[var(--ctp-green)]/30";
  if (score >= 60)
    return "bg-[var(--ctp-yellow)]/20 text-[var(--ctp-yellow)] border-[var(--ctp-yellow)]/30";
  return "bg-[var(--ctp-overlay)]/20 text-[var(--ctp-subtext)] border-[var(--ctp-overlay)]/30";
};

function twitchTimestamp(url: string, seconds: number): string {
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

// Font options for subtitle styling
const FONT_OPTIONS = [
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

function ClipListVirtual({
  clips,
  selectedIds,
  onToggle,
  projectId,
  onClipUpdate,
  sourcePath,
  originalSource,
}: ClipListVirtualProps) {
  const [expandedClipId, setExpandedClipId] = useState<string | null>(null);
  const [cropCanvasKey, setCropCanvasKey] = useState(0); // For forcing CropCanvas refresh
  const [cropSegmentPaths, setCropSegmentPaths] = useState<Record<string, string>>({});
  const [cropRefreshing, setCropRefreshing] = useState<Record<string, boolean>>({});

  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Clip | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSchedule, setShowSchedule] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [expandedSections, setExpandedSections] = useState<
    Record<
      string,
      {
        preview?: boolean;
        crops?: boolean;
        subtitles?: boolean;
        timing?: boolean;
        why?: boolean;
      }
    >
  >({});
  // Per-clip improved transcripts (retranscription)
  const [improvedSegments, setImprovedSegments] = useState<
    Map<string, Transcript>
  >(new Map());
  const [improveProgress, setImproveProgress] = useState<
    Record<string, { value: number; label: string } | null>
  >({});
  const [improveModel, setImproveModel] = useState<Record<string, string>>({});

  const toggleSection = (
    clipKey: string,
    section: "preview" | "crops" | "subtitles" | "timing" | "why",
  ) => {
    setExpandedSections((prev) => ({
      ...prev,
      [clipKey]: {
        ...prev[clipKey],
        [section]: !prev[clipKey]?.[section],
      },
    }));
  };

  const isSectionExpanded = (
    clipKey: string,
    section: "preview" | "crops" | "subtitles" | "timing",
  ) => {
    return !!expandedSections[clipKey]?.[section];
  };

  // Per-clip render state
  const [renderState, setRenderState] = useState<
    Record<
      string,
      {
        progress: { value: number; label: string } | null;
        downloadUrl: string | null;
        error: string | null;
        isCancelling: boolean;
        cropBoxes: { gameplay: CropBox; avatar: CropBox };
        fontName: string;
        fontColor: string;
        highlightColor: string;
        outlineColor: string;
        outlineWidth: number;
        shadowColor: string;
        shadowDepth: number;
        shadowOpacity: number;
        fontSize: number;
        subtitleFadeIn: number;
        subtitleFadeOut: number;
        captionStyle: string;
        wordsPerLine: number;
        qualityPreset: string;
        previewRefresh?: number; // Timestamp to force preview image refresh
      }
    >
  >({});

  const getRenderState = (clipId: string) => {
    if (!renderState[clipId]) {
      return {
        progress: null,
        downloadUrl: null,
        error: null,
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
      };
    }
    return renderState[clipId];
  };

  const updateRenderState = (
    clipId: string,
    patch: Partial<(typeof renderState)[string]>,
  ) => {
    setRenderState((prev) => ({
      ...prev,
      [clipId]: { ...getRenderState(clipId), ...patch },
    }));
  };

  const getClipKey = (clip: Clip): string => {
    // Use clip.id as primary key, fall back to stable index-based key
    if (clip.id) return clip.id;
    return `clip-${clip.start}-${clip.end}`;
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
      await updateClip(projectId, clipIndex, {
        title: editForm.title,
        start: editForm.start,
        end: editForm.end,
        hashtags: editForm.hashtags,
        brand_alignment: editForm.brand_alignment,
        reason: editForm.reason,
        virality_score: editForm.virality_score,
      });
      onClipUpdate(editingClipId, editForm);
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

      // Download segment if needed for URL sources
      const segPath = await downloadSegment(
        sourcePath,
        clip.start,
        clip.end,
        (value, label) =>
          updateRenderState(clipKey, {
            progress: { value: value * 0.4, label },
          }),
        controller.signal,
      );

      const duration = clip.end - clip.start;
      updateRenderState(clipKey, {
        progress: { value: 0.4, label: "Rendering clip..." },
      });

      const outUrl = await renderClip(
        {
          video_path: segPath,
          clip: { ...clip, start: 0, end: duration },
          crop_avatar: state.cropBoxes.avatar,
          crop_game: state.cropBoxes.gameplay,
          segments: [], // TODO: Pass transcript segments
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
        const segPath = await downloadSegment(
          source,
          clip.start,
          clip.end,
          () => {},
        );
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
                      onChange={(e) => handleTimeChange("end", e.target.value)}
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
                  <Button onClick={handleCancel} variant="secondary" size="sm">
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          );
        }

        if (isExpanded) {
          return (
            <div
              key={clipKey}
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
                  <span
                    className={`text-xs px-2 py-1 rounded font-medium border ${getViralityBadgeColor(clip.virality_score || 0)}`}
                  >
                    {clip.virality_score || 0}/100
                  </span>
                </div>

                {/* Why This Clip Section - collapsible */}
                <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleSection(clipKey, "why")}
                    className="w-full px-3 py-2 bg-[var(--ctp-surface)] flex items-center justify-between text-left hover:bg-[var(--ctp-surface-2)]"
                  >
                    <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">
                      Why This Clip
                    </span>
                    <span className="text-xs text-[var(--ctp-subtext)]">
                      {expandedSections[clipKey]?.["why"] ? "−" : "+"}
                    </span>
                  </button>
                  {expandedSections[clipKey]?.["why"] && (
                    <div className="p-3 space-y-3">
                      {clip.reason && (
                        <div>
                          <p className="text-xs font-medium text-[var(--ctp-text)] mb-1">
                            Viral Hook
                          </p>
                          <p className="text-xs text-[var(--ctp-subtext)]">
                            {clip.reason}
                          </p>
                        </div>
                      )}
                      {clip.recommendation_reason && (
                        <div>
                          <p className="text-xs font-medium text-[var(--ctp-text)] mb-1">
                            Why Recommended
                          </p>
                          <p className="text-xs text-[var(--ctp-subtext)] leading-relaxed">
                            {clip.recommendation_reason}
                          </p>
                        </div>
                      )}
                      {(clip.brand_alignment || []).length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-[var(--ctp-text)] mb-1">
                            Brand Alignment
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {(clip.brand_alignment || []).map((pillar, idx) => (
                              <span
                                key={idx}
                                className="text-[10px] px-2 py-0.5 rounded bg-[var(--ctp-mauve)]/20 text-[var(--ctp-mauve)] border border-[var(--ctp-mauve)]/30"
                              >
                                {pillar}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Timing Section - collapsible */}
                <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleSection(clipKey, "timing")}
                    className="w-full px-3 py-2 bg-[var(--ctp-surface)] flex items-center justify-between text-left hover:bg-[var(--ctp-surface-2)]"
                  >
                    <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">
                      Timing
                    </span>
                    <span className="text-xs text-[var(--ctp-subtext)]">
                      {expandedSections[clipKey]?.["timing"] ? "−" : "+"}
                    </span>
                  </button>
                  {expandedSections[clipKey]?.["timing"] && (
                    <div className="p-3 space-y-2">
                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1">
                          <span className="text-xs text-[var(--ctp-subtext)]">
                            Start (s)
                          </span>
                          <input
                            type="number"
                            value={clip.start}
                            step={0.5}
                            min={0}
                            readOnly
                            className="input-field bg-[var(--ctp-surface)]"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-[var(--ctp-subtext)]">
                            End (s)
                          </span>
                          <input
                            type="number"
                            value={clip.end}
                            step={0.5}
                            min={0}
                            readOnly
                            className="input-field bg-[var(--ctp-surface)]"
                          />
                        </label>
                      </div>
                      <p className="text-xs text-[var(--ctp-subtext)]">
                        Duration: {(clip.end - clip.start).toFixed(1)}s — target
                        is 9–90 seconds.
                      </p>
                      {originalSource && (
                        <div className="pt-2 border-t border-[var(--ctp-overlay)]">
                          <p className="text-xs text-[var(--ctp-subtext)] mb-1">
                            Soft clip:
                          </p>
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
                      <p className="text-xs text-[var(--ctp-subtext)] italic">
                        Edit in Timeline Editor for precise adjustments
                      </p>
                    </div>
                  )}
                </div>

                {/* Improve Subtitles (Retranscription) */}
                <div className="border border-[var(--ctp-overlay)] rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">
                      Improve Subtitles
                    </p>
                    {hasImprovedTranscript && (
                      <span className="text-xs text-green-400 flex items-center gap-1">
                        <span>✓</span> High-quality transcript ready
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--ctp-subtext)]">
                    Re-transcribe this clip with a larger model for better
                    word-level accuracy.
                  </p>
                  <div className="flex items-center gap-3">
                    <select
                      className="bg-zinc-800 border border-[var(--ctp-overlay)] rounded px-2 py-1 text-xs text-white"
                      value={improveModel[clipKey] || "large-v3"}
                      onChange={(e) => {
                        const newModels = {
                          ...improveModel,
                          [clipKey]: e.target.value,
                        };
                        setImproveModel(newModels);
                      }}
                    >
                      <option value="medium">
                        medium — fast, good quality
                      </option>
                      <option value="large-v3">large-v3 — best accuracy</option>
                      <option value="large-v3-turbo">
                        large-v3-turbo — balanced speed
                      </option>
                    </select>
                    <button
                      onClick={() => handleImproveSubtitles(clip, clipKey)}
                      disabled={
                        !!improveProgress[clipKey] || hasImprovedTranscript
                      }
                      className="text-xs px-3 py-1 rounded bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] text-[var(--ctp-text)] hover:bg-[var(--ctp-mauve)] hover:text-white disabled:opacity-50"
                    >
                      {improveProgress[clipKey]
                        ? "Transcribing…"
                        : hasImprovedTranscript
                          ? "Done"
                          : "Transcribe Clip"}
                    </button>
                  </div>
                  {improveProgress[clipKey] && (
                    <ProgressBar
                      progress={improveProgress[clipKey]!.value}
                      label={improveProgress[clipKey]!.label}
                    />
                  )}
                </div>

                {/* Preview Section - collapsible */}
                <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleSection(clipKey, "preview")}
                    className="w-full px-3 py-2 bg-[var(--ctp-surface)] flex items-center justify-between text-left hover:bg-[var(--ctp-surface-2)]"
                  >
                    <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">
                      Preview (9:16)
                    </span>
                    <span className="text-xs text-[var(--ctp-subtext)]">
                      {isSectionExpanded(clipKey, "preview") ? "−" : "+"}
                    </span>
                  </button>
                  {isSectionExpanded(clipKey, "preview") && (
                    <div className="p-3">
                      <div
                        className="relative mx-auto overflow-hidden rounded-lg border-2 border-[var(--ctp-mauve)] shadow-xl"
                        style={{
                          width: "100%",
                          maxWidth: 270,
                          aspectRatio: "9/16",
                          background: "#181825",
                        }}
                      >
                        <div className="absolute left-0 top-0 w-full h-1/2 overflow-hidden bg-[#181825]">
                          <img
                            src={frameUrl(originalSource || sourcePath, clip.start + 2)}
                            alt="avatar preview"
                            className="w-full h-full"
                            style={{
                              objectFit: "cover",
                              objectPosition: `${((state.cropBoxes.avatar.x + state.cropBoxes.avatar.w / 2) / 1920) * 100}% ${((state.cropBoxes.avatar.y + state.cropBoxes.avatar.h / 2) / 1080) * 100}%`,
                            }}
                          />
                        </div>
                        <div className="absolute left-0 bottom-0 w-full h-1/2 overflow-hidden bg-[#181825]">
                          <img
                            src={frameUrl(originalSource || sourcePath, clip.start + 2)}
                            alt="gameplay preview"
                            className="w-full h-full"
                            style={{
                              objectFit: "cover",
                              objectPosition: `${((state.cropBoxes.gameplay.x + state.cropBoxes.gameplay.w / 2) / 1920) * 100}% ${((state.cropBoxes.gameplay.y + state.cropBoxes.gameplay.h / 2) / 1080) * 100}%`,
                            }}
                          />
                        </div>
                        <div
                          className="absolute left-0 right-0 bottom-0 flex items-center justify-center px-3 py-2 pointer-events-none"
                          style={{
                            background: "rgba(0,0,0,0.6)",
                            height: "12%",
                          }}
                        >
                          <span className="text-[10px] text-white font-medium truncate">
                            {clip.title}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Crop Areas - collapsible */}
                <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
                  <div className="w-full px-3 py-2 bg-[var(--ctp-surface)] flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">
                      Crop Areas
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRefreshCrop(clip, clipKey)}
                        disabled={cropRefreshing[clipKey]}
                        className="text-xs text-[var(--ctp-blue)] hover:text-[var(--ctp-text)] flex items-center gap-1 disabled:opacity-50"
                        title="Download segment and refresh crop preview"
                      >
                        {cropRefreshing[clipKey] ? (
                          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        )}
                        {cropRefreshing[clipKey] ? "Downloading…" : "Refresh"}
                      </button>
                      <button
                        onClick={() => toggleSection(clipKey, "crops")}
                        className="text-xs text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)]"
                      >
                        {isSectionExpanded(clipKey, "crops") ? "−" : "+"}
                      </button>
                    </div>
                  </div>
                  {isSectionExpanded(clipKey, "crops") && (
                    <div className="p-3">
                      <CropCanvas
                        key={cropCanvasKey}
                        frameUrl={`${frameUrl(cropSegmentPaths[clipKey] || originalSource || sourcePath, cropSegmentPaths[clipKey] ? 0 : clip.start)}&_cb=${Date.now()}`}
                        videoDimensions={{ w: 1920, h: 1080 }}
                        onChange={handleCropChange(clipKey)}
                        initialGameplay={state.cropBoxes.gameplay}
                        initialAvatar={state.cropBoxes.avatar}
                      />
                    </div>
                  )}
                </div>

                {/* Subtitle Style - collapsible */}
                <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleSection(clipKey, "subtitles")}
                    className="w-full px-3 py-2 bg-[var(--ctp-surface)] flex items-center justify-between text-left hover:bg-[var(--ctp-surface-2)]"
                  >
                    <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">
                      Subtitle Style
                    </span>
                    <span className="text-xs text-[var(--ctp-subtext)]">
                      {isSectionExpanded(clipKey, "subtitles") ? "−" : "+"}
                    </span>
                  </button>
                  {isSectionExpanded(clipKey, "subtitles") && (
                    <div className="p-3 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1">
                          <span className="text-xs text-[var(--ctp-subtext)]">
                            Font
                          </span>
                          <select
                            value={state.fontName}
                            onChange={(e) =>
                              updateRenderState(clipKey, {
                                fontName: e.target.value,
                              })
                            }
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
                          <span className="text-xs text-[var(--ctp-subtext)]">
                            Font size
                          </span>
                          <input
                            type="number"
                            value={state.fontSize}
                            onChange={(e) =>
                              updateRenderState(clipKey, {
                                fontSize: Number(e.target.value),
                              })
                            }
                            min={12}
                            max={72}
                            className="input-field"
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1">
                          <span className="text-xs text-[var(--ctp-subtext)]">
                            Text color
                          </span>
                          <input
                            type="color"
                            value={state.fontColor}
                            onChange={(e) =>
                              updateRenderState(clipKey, {
                                fontColor: e.target.value,
                              })
                            }
                            className="w-full h-8"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-[var(--ctp-subtext)]">
                            Highlight color
                          </span>
                          <input
                            type="color"
                            value={state.highlightColor}
                            onChange={(e) =>
                              updateRenderState(clipKey, {
                                highlightColor: e.target.value,
                              })
                            }
                            className="w-full h-8"
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1">
                          <span className="text-xs text-[var(--ctp-subtext)]">
                            Outline color
                          </span>
                          <input
                            type="color"
                            value={state.outlineColor}
                            onChange={(e) =>
                              updateRenderState(clipKey, {
                                outlineColor: e.target.value,
                              })
                            }
                            className="w-full h-8"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-[var(--ctp-subtext)]">
                            Outline width: {state.outlineWidth.toFixed(1)}px
                          </span>
                          <input
                            type="range"
                            value={state.outlineWidth}
                            onChange={(e) =>
                              updateRenderState(clipKey, {
                                outlineWidth: Number(e.target.value),
                              })
                            }
                            min={0}
                            max={5}
                            step={0.1}
                            className="w-full"
                          />
                        </label>
                      </div>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`caption-style-${clipKey}`}
                            value="karaoke"
                            checked={state.captionStyle === "karaoke"}
                            onChange={() =>
                              updateRenderState(clipKey, {
                                captionStyle: "karaoke",
                              })
                            }
                            className="accent-[var(--ctp-mauve)]"
                          />
                          <span className="text-xs text-[var(--ctp-text)]">
                            Karaoke (sweep)
                          </span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`caption-style-${clipKey}`}
                            value="capcut"
                            checked={state.captionStyle === "capcut"}
                            onChange={() =>
                              updateRenderState(clipKey, {
                                captionStyle: "capcut",
                              })
                            }
                            className="accent-[var(--ctp-mauve)]"
                          />
                          <span className="text-xs text-[var(--ctp-text)]">
                            CapCut (uniform)
                          </span>
                        </label>
                      </div>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`quality-${clipKey}`}
                            value="standard"
                            checked={state.qualityPreset === "standard"}
                            onChange={() =>
                              updateRenderState(clipKey, {
                                qualityPreset: "standard",
                              })
                            }
                            className="accent-[var(--ctp-mauve)]"
                          />
                          <div>
                            <span className="text-xs text-[var(--ctp-text)] block">
                              Standard
                            </span>
                            <span className="text-[10px] text-[var(--ctp-subtext)]">
                              Faster encode, CRF 18
                            </span>
                          </div>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`quality-${clipKey}`}
                            value="production"
                            checked={state.qualityPreset === "production"}
                            onChange={() =>
                              updateRenderState(clipKey, {
                                qualityPreset: "production",
                              })
                            }
                            className="accent-[var(--ctp-mauve)]"
                          />
                          <div>
                            <span className="text-xs text-[var(--ctp-text)] block">
                              Production
                            </span>
                            <span className="text-[10px] text-[var(--ctp-subtext)]">
                              Near-lossless, CRF 12
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {/* Render Section */}
                <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-[var(--ctp-surface)]">
                    <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">
                      {state.progress
                        ? "Rendering..."
                        : state.downloadUrl
                          ? "Render Complete"
                          : "Render Clip"}
                    </span>
                  </div>
                  <div className="p-3 space-y-3">
                    {state.progress && (
                      <div className="space-y-2">
                        <ProgressBar
                          progress={state.progress.value}
                          label={state.progress.label}
                        />
                        <div className="flex justify-end">
                          <button
                            onClick={() => handleRenderCancel(clipKey)}
                            disabled={state.isCancelling}
                            className="text-xs text-[var(--ctp-red)] hover:text-[var(--ctp-red)]/80 disabled:opacity-50 flex items-center gap-1"
                          >
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                            {state.isCancelling ? "Cancelling..." : "Cancel"}
                          </button>
                        </div>
                      </div>
                    )}
                    {state.error && (
                      <div className="bg-[var(--ctp-red)]/10 border border-[var(--ctp-red)]/30 rounded p-3">
                        <p className="text-xs text-[var(--ctp-red)] font-mono whitespace-pre-wrap">
                          {state.error}
                        </p>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleRender(clip, clipKey)}
                        disabled={!!state.progress || state.isCancelling}
                        className="btn-primary flex-1"
                      >
                        {state.progress
                          ? "Rendering..."
                          : state.isCancelling
                            ? "Cancelling..."
                            : "Render Clip"}
                      </button>
                      {state.downloadUrl && (
                        <a
                          href={state.downloadUrl}
                          download
                          className="btn-secondary"
                        >
                          <svg
                            className="w-4 h-4 mr-1"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                            />
                          </svg>
                          Download
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t border-[var(--ctp-overlay)]">
                  <Button
                    onClick={() => setExpandedClipId(null)}
                    variant="secondary"
                    size="sm"
                  >
                    Collapse
                  </Button>
                  <Button
                    onClick={() => setShowSchedule(clipKey)}
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

        // Display mode (collapsed) - 3-column grid card
        return (
          <div key={clipKey} className="glass-card p-3 col-span-1" role="listitem">
            <div className="flex flex-col h-full">
              {/* Header with checkbox and virality score */}
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
                <span
                  className={`text-xs px-1.5 py-0.5 rounded font-medium border flex-shrink-0 ${getViralityBadgeColor(clip.virality_score || 0)}`}
                >
                  {clip.virality_score || 0}
                </span>
              </div>

              {/* Time range */}
              <p className="text-xs text-[var(--ctp-subtext)] mb-2">
                {formatTime(clip.start)} - {formatTime(clip.end)}
                <span className="ml-1 opacity-60">
                  ({(clip.end - clip.start).toFixed(0)}s)
                </span>
              </p>

              {/* Reason/brand alignment preview */}
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

              {/* Hashtags */}
              {/* Action buttons */}
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
  );
}
