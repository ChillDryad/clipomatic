import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getRecentVideos } from "../api";
import type { RecentVideo } from "../api";

export function HomePage() {
  const [videos, setVideos] = useState<RecentVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getRecentVideos()
      .then(setVideos)
      .catch((err) => {
        console.error(err);
        setLoadError("Failed to load videos");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Hero - Start New Project */}
      <div className="glass-card p-5">
        <h1 className="text-2xl font-bold text-[var(--ctp-text)] mb-2">
          Start New Project
        </h1>
        <p className="text-[var(--ctp-subtext)] mb-5">
          Upload a video or paste a YouTube/Twitch URL to begin
        </p>

        <div className="flex gap-3 flex-col sm:flex-row">
          <label htmlFor="url-input" className="sr-only">
            Video URL
          </label>
          <input
            id="url-input"
            type="url"
            placeholder="YouTube, Twitch, or Kick URL..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="glass-input flex-1 px-4 py-3 rounded-lg min-h-[44px]"
          />
          <Link
            to={
              urlInput
                ? `/pipeline?url=${encodeURIComponent(urlInput)}`
                : "/clip-studio"
            }
            className="btn-momiji-primary px-6 py-3 rounded-lg whitespace-nowrap min-h-[44px] flex items-center justify-center"
          >
            {urlInput ? 'Import source for Clip Studio' : 'Open Clip Studio'}
          </Link>
        </div>
      </div>

      {/* Use videosComponent instead. */}
      {/* Recent Videos */}
      <section aria-labelledby="recent-heading">
        <h2
          id="recent-heading"
          className="text-lg font-semibold text-[var(--ctp-text)] mb-3"
        >
          Recent Videos
        </h2>

        {loading ? (
          <div
            className="glass-card p-6 text-center"
            role="status"
            aria-live="polite"
          >
            <span className="text-[var(--ctp-subtext)]">Loading your garden... 🌸</span>
          </div>
        ) : loadError ? (
          <div className="glass-card p-6 text-center" role="alert">
            <p className="text-[var(--ctp-red)] mb-2">{loadError}</p>
            <button
              onClick={() => {
                setLoadError(null);
                setLoading(true);
                getRecentVideos()
                  .then(setVideos)
                  .catch((e) => {
                    setLoadError("Failed to load videos");
                    setLoading(false);
                  })
                  .finally(() => setLoading(false));
              }}
              className="btn-secondary text-sm"
            >
              Retry
            </button>
          </div>
        ) : videos.length === 0 ? (
          <div className="glass-card-subtle p-8 text-center">
            <div className="text-5xl mb-4 animate-pulse-slow">🌸</div>
            <h3 className="text-base font-semibold text-[var(--ctp-text)]">
              Your clip garden is empty
            </h3>
            <p className="text-sm text-[var(--ctp-subtext)] mt-2">
              Upload a VOD to start growing your momiji moments 🍁
            </p>
            <div className="mt-6">
              <Link to="/clip-studio" className="btn-momiji-primary">
                <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Open Clip Studio
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {videos.map((video) => (
              <VideoCard key={video.sourcePath} video={video} />
            ))}
          </div>
        )}
      </section>

      {/* Quick Links */}
      <nav className="flex gap-2 flex-wrap" aria-label="Quick links">
        <Link to="/clip-studio" className="btn-secondary">
          New Project
        </Link>
        <Link to="/schedule" className="btn-secondary">
          Post Schedule
        </Link>
      </nav>
    </div>
  );
}

function VideoCard({ video }: { video: RecentVideo }) {
  const encodedPath = encodeURIComponent(video.sourcePath);
  const stem =
    video.sourcePath
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? video.title;

  return (
    <Link
      to={`/video/${encodedPath}`}
      className="glass-card p-4 hover:border-[var(--ctp-mauve)] transition-colors cursor-pointer block"
      aria-label={`${stem}, ${video.clipCount} clips`}
    >
      {/* Thumbnail placeholder */}
      <div
        className="bg-[var(--ctp-surface-1)] rounded-lg mb-3 aspect-video flex items-center justify-center"
        aria-hidden="true"
      >
        <svg
          className="w-10 h-10 text-[var(--ctp-overlay)]"
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
      <h3 className="font-semibold text-[var(--ctp-text)] truncate">{stem}</h3>
      <p className="text-sm text-[var(--ctp-subtext)]">
        {video.clipCount} clips
      </p>
    </Link>
  );
}
