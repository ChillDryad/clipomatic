import { ProgressBar } from "../../components/ui/ProgressBar";
import type { CropBox } from "../../types";

interface ClipSectionRenderProps {
  progress: { value: number; label: string } | null;
  downloadUrl: string | null;
  error: string | null;
  isCancelling: boolean;
  onRender: () => void;
  onCancel: () => void;
}

export function ClipSectionRender({
  progress,
  downloadUrl,
  error,
  isCancelling,
  onRender,
  onCancel,
}: ClipSectionRenderProps) {
  return (
    <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-[var(--ctp-surface)]">
        <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">
          {progress
            ? "Rendering..."
            : downloadUrl
              ? "🌸 Your clip is ready to bloom!"
              : "Render Clip"}
        </span>
      </div>
      <div className="p-3 space-y-3">
        {progress && (
          <div className="space-y-2">
            <ProgressBar
              progress={progress.value}
              label={progress.label}
            />
            <div className="flex justify-end">
              <button
                onClick={onCancel}
                disabled={isCancelling}
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
                {isCancelling ? "Cancelling..." : "Cancel"}
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="bg-[var(--ctp-red)]/10 border border-[var(--ctp-red)]/30 rounded p-3">
            <p className="text-xs text-[var(--ctp-red)] font-mono whitespace-pre-wrap">
              {error}
            </p>
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={onRender}
            disabled={!!progress || isCancelling}
            className="btn-primary flex-1"
          >
            {progress
              ? "Rendering..."
              : isCancelling
                ? "Cancelling..."
                : "Render Clip"}
          </button>
          {downloadUrl && (
            <a href={downloadUrl} download className="btn-secondary">
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
  );
}
