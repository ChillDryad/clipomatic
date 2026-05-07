import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { ProgressBar } from "../../components/ui/ProgressBar";

const WHISPER_MODELS = [
  "tiny",
  "base",
  "small",
  "medium",
  "large-v3-turbo",
  "large-v3",
];

interface RetranscribePanelProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
  onReTranscribe: () => void;
  transcribing: boolean;
  progress: { value: number; label: string } | null;
}

export function RetranscribePanel({
  selectedModel,
  onModelChange,
  onReTranscribe,
  transcribing,
  progress,
}: RetranscribePanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-2">
        {!expanded ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setExpanded(true)}
          >
            Re-transcribe
          </Button>
        ) : (
          <>
            <select
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={transcribing}
              className="text-xs px-2 py-1.5 rounded bg-[var(--ctp-surface)] border border-[var(--ctp-overlay)] text-[var(--ctp-text)] disabled:opacity-50"
            >
              {WHISPER_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              size="sm"
              onClick={onReTranscribe}
              disabled={transcribing}
            >
              {transcribing ? "Transcribing..." : "Go"}
            </Button>
            <button
              onClick={() => setExpanded(false)}
              className="text-xs text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)]"
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {progress && (
        <div className="mt-2">
          <ProgressBar progress={progress.value} label={progress.label} />
        </div>
      )}
    </div>
  );
}
