import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { frameUrl } from "../../api";
import { useInfiniteProjects } from "../../hooks/useInfiniteProjects";
import { ProjectCard } from "../ui/ProjectCard";
import { LoadingSpinner } from "../ui/LoadingSpinner";

export interface ProjectListProps {
  teamId?: string | null;
  title?: string;
  autoLoad?: boolean;
  emptyStateMessage?: string;
  emptyStateActionLabel?: string;
  emptyStateActionLink?: string;
  onProjectClick?: (projectId: string) => void;
  className?: string;
}

export function ProjectList({
  teamId = null,
  title = "My Projects",
  autoLoad = true,
  emptyStateMessage = "Upload a video or paste a URL to create your first project and start generating clips",
  emptyStateActionLabel = "Start Your First Project",
  emptyStateActionLink = "/pipeline",
  className = "",
  onProjectClick,
}: ProjectListProps) {
  const {
    allProjects,
    total,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch,
  } = useInfiniteProjects({ teamId, enabled: true });

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoLoad || !hasNextPage || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [autoLoad, hasNextPage, fetchNextPage, isFetchingNextPage]);


  if (isLoading) {
    return <LoadingSpinner label="Loading projects..." />;
  }

  if (isError) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="glass-card p-8 text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--ctp-red-20)] flex items-center justify-center">
            <svg
              className="w-8 h-8 text-[var(--ctp-red)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--ctp-text)] mb-2">
            Failed to load projects
          </h3>
          <p className="text-sm text-[var(--ctp-red)] mb-6">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
          <button
            onClick={() => refetch()}
            className="btn-primary inline-flex items-center gap-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Section header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-[var(--ctp-text)] flex items-center gap-2">
          <svg
            className="w-5 h-5 text-[var(--ctp-mauve)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
          {title}
        </h2>
        <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--ctp-mauve-20)] text-[var(--ctp-mauve)] font-medium">
          {allProjects.length} of {total} project
          {allProjects.length !== 1 ? "s" : ""}
        </span>
      </div>

      {allProjects.length === 0 ? (
        /* Empty state */
        <div className="glass-card p-12 text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[var(--ctp-mauve-20)] to-[var(--ctp-blue-20)] flex items-center justify-center">
            <svg
              className="w-10 h-10 text-[var(--ctp-mauve)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-[var(--ctp-text)] mb-2">
            No projects yet
          </h3>
          <p className="text-[var(--ctp-subtext)] mb-6 max-w-sm mx-auto">
            {emptyStateMessage}
          </p>
          <Link
            to={emptyStateActionLink}
            className="btn-primary inline-flex items-center gap-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4v16m8-8H4"
              />
            </svg>
            {emptyStateActionLabel}
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allProjects.map((project) => (
              <ProjectCard
                key={project.id}
                projectId={project.id}
                title={project.original_filename}
                thumbnailUrl={frameUrl(project.original_source || project.source_path, project.duration ? project.duration * 0.5 : 2)}
                duration={project.duration ?? undefined}
                clipCount={project.clip_count ?? 0}
                status={project.status}
                createdAt={project.created_at}
                showGradientOverlay
                zoomIntensity="lg"
                renderStatus={(status) => (
                  <span
                    className={`text-[10px] px-2 py-1 rounded-full font-semibold shadow-lg backdrop-blur-sm ${
                      status === "complete"
                        ? "bg-[var(--ctp-green)]/90 text-white"
                        : status === "processing"
                          ? "bg-[var(--ctp-blue)]/90 text-white animate-pulse"
                          : status === "failed"
                            ? "bg-[var(--ctp-red)]/90 text-white"
                            : "bg-[var(--ctp-overlay)]/90 text-white"
                    }`}
                  >
                    {status === "processing" && (
                      <svg
                        className="inline w-3 h-3 mr-1 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
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
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    )}
                    {status}
                  </span>
                )}
                onClick={onProjectClick ? () => onProjectClick(project.id) : undefined}
              />
            ))}
          </div>

          {/* Auto-load sentinel or manual Load More */}
          {hasNextPage && (
            <>
              {autoLoad ? (
                <div ref={sentinelRef} className="h-4" />
              ) : (
                <div className="mt-6 flex justify-center">
                  <button
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="btn-secondary flex items-center gap-2"
                  >
                    {isFetchingNextPage ? (
                      <>
                        <svg
                          className="w-4 h-4 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
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
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        Loading...
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                        Load More
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
