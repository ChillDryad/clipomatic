import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { Button } from "../../components/ui/Button";
import { getConfig, deleteProject, transcribe, detectHighlights, getCachedTranscript, getAbortController, cancelOperation, getVideoDimensions } from "../../api";
import type { Clip } from "../../types";
import { getRoleBadgeClass } from "../../utils/roles";
import { ProjectHeader } from "./ProjectHeader";
import { ClipList } from "./ClipList";
import { getClipKey } from "./utils";
import type { VideoProject, TeamMember } from "./types";

export function VideoProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [showBatchSchedule, setShowBatchSchedule] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [nvencAvailable, setNvencAvailable] = useState(true);
  const [videoDimensions, setVideoDimensions] = useState<{ w: number; h: number }>({ w: 1920, h: 1080 });
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState<{ value: number; label: string } | null>(null);
  const [selectedWhisperModel, setSelectedWhisperModel] = useState("large-v3");
  const [redetecting, setRedetecting] = useState(false);
  const [redetectProgress, setRedetectProgress] = useState<{ value: number; label: string } | null>(null);
  const configRef = useRef<{ llm_model: string } | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login", { replace: true });
      return;
    }
    if (!projectId) return;
    loadProject(projectId);
  }, [projectId, isAuthenticated]);

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setNvencAvailable(cfg.nvenc_available);
        if (cfg.whisper_model) setSelectedWhisperModel(cfg.whisper_model);
        configRef.current = { llm_model: cfg.llm_model };
      })
      .catch(() => setNvencAvailable(false));
  }, []);

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

      // Fetch video dimensions
      if (projectData.source_path) {
        getVideoDimensions(projectData.source_path)
          .then(setVideoDimensions)
          .catch((err) => {
            console.error("Failed to get video dimensions:", err);
          });
      }

      if (clipsRes.ok) {
        const clipsData = await clipsRes.json();
        const rawClips = clipsData.clips || clipsData || [];
        const normalizedClips = rawClips.map((clip: any) => ({
          ...clip,
          start: clip.start ?? clip.start_time,
          end: clip.end ?? clip.end_time,
          id:
            clip.id ||
            `clip-${clip.start ?? clip.start_time}-${clip.end ?? clip.end_time}`,
        }));
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

  const handleClipUpdate = (clipId: string, updated: Clip) => {
    setClips((prev) =>
      prev.map((clip) => {
        const key = clip.id ? clip.id : `clip-${clip.start}-${clip.end}`;
        return key === clipId ? updated : clip;
      }),
    );
  };

  const handleDelete = async () => {
    if (!projectId) return;
    setDeleting(true);
    try {
      await deleteProject(projectId);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      console.error("Failed to delete project:", err);
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleReTranscribe = async () => {
    if (!project) return;
    setTranscribing(true);
    setTranscribeProgress({ value: 0, label: "Starting transcription…" });
    try {
      const controller = getAbortController("retranscribe");
      const result = await transcribe(
        {
          video_path: project.source_path,
          model_size: selectedWhisperModel,
          device: "auto",
          project_id: projectId,
        },
        (value, label) => setTranscribeProgress({ value, label }),
        controller.signal,
      );
      setTranscribeProgress(null);
      // Reload project and clips after retranscription
      await loadProject(projectId!);
    } catch (err) {
      setTranscribeProgress(null);
      if (!String(err).includes("cancelled")) {
        console.error("Retranscription failed:", err);
      }
    } finally {
      setTranscribing(false);
    }
  };

  const handleRedetectClips = async () => {
    if (!project) return;
    setRedetecting(true);
    setRedetectProgress({ value: 0, label: "Loading transcript…" });
    try {
      const transcript = await getCachedTranscript(project.source_path);
      if (!transcript) {
        throw new Error("No cached transcript found. Please re-transcribe first.");
      }

      const model = configRef.current?.llm_model || "llama3.1:8b";
      const controller = getAbortController("redetect");

      await detectHighlights(
        transcript,
        model,
        project.source_path,
        (value, label) => setRedetectProgress({ value, label }),
        projectId,
      );

      setRedetectProgress(null);
      await loadProject(projectId!);
    } catch (err) {
      setRedetectProgress(null);
      if (!String(err).includes("cancelled")) {
        console.error("Highlight redetection failed:", err);
      }
    } finally {
      setRedetecting(false);
    }
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
          Growing your project... 🌱
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
  const allClipKeys = clips.map((c) => getClipKey(c));
  const selectAll = () => setSelectedClipIds(new Set(allClipKeys));

  return (
    <div className="space-y-6">
      <ProjectHeader
        project={project}
        clipsCount={clips.length}
        projectId={projectId!}
        members={members}
        selectedClipIds={selectedClipIds}
        allClipKeys={allClipKeys}
        onSelectAll={selectAll}
        onClearSelection={() => setSelectedClipIds(new Set())}
        onDeleteProject={() => setShowDeleteConfirm(true)}
        selectedWhisperModel={selectedWhisperModel}
        onWhisperModelChange={setSelectedWhisperModel}
        onReTranscribe={handleReTranscribe}
        transcribing={transcribing}
        transcribeProgress={transcribeProgress}
        onRedetectClips={handleRedetectClips}
        redetecting={redetecting}
        redetectProgress={redetectProgress}
      />

      {/* Clips Grid */}
      <div>
        <h2 className="text-base font-semibold text-[var(--ctp-text)] mb-4">
          Detected Clips ({clips.length})
        </h2>

        {clips.length === 0 ? (
          <div className="glass-card-subtle p-8 text-center">
            <div className="text-5xl mb-4 animate-pulse-slow">✨</div>
            <h3 className="text-base font-semibold text-[var(--ctp-text)]">
              No clips yet — waiting to bloom
            </h3>
            <p className="text-sm text-[var(--ctp-subtext)] mt-2">
              Run highlight detection to find viral moments in your VOD
            </p>
            <div className="mt-6">
              <Link
                to={`/pipeline?restore=${project.id}`}
                className="btn-momiji-primary"
              >
                Run Highlight Detection
              </Link>
            </div>
          </div>
        ) : (
          <ClipList
            clips={sortedClips}
            selectedIds={selectedClipIds}
            onToggle={toggleClip}
            projectId={project.id}
            onClipUpdate={handleClipUpdate}
            sourcePath={project.source_path}
            originalSource={project.original_source}
            nvencAvailable={nvencAvailable}
            videoDimensions={videoDimensions}
          />
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
                  member.user?.display_name || member.user?.email || "Unknown";
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
                          member.user?.email !== member.user?.display_name && (
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

      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="glass-card p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-semibold text-[var(--ctp-text)] mb-2">
              Delete Project
            </h3>
            <p className="text-sm text-[var(--ctp-subtext)] mb-6">
              Are you sure you want to delete this project? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                onClick={() => setShowDeleteConfirm(false)}
                variant="secondary"
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleDelete}
                variant="danger"
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}

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
