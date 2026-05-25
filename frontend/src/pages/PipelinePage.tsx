import { usePipeline } from '../context/PipelineContext'
import { StepIngest } from '../components/steps/StepIngest'
import { StepTranscribe } from '../components/steps/StepTranscribe'
import { StepHighlights } from '../components/steps/StepHighlights'
import { StepReview } from '../components/steps/StepReview'
import { BreadcrumbSteppers } from '../components/layout/BreadcrumbSteppers'

export function PipelinePage() {
  const { step, source, transcript, clips, autoPipelineEnabled, setAutoPipelineEnabled } = usePipeline()

  return (
    <div className="space-y-6">
      {/* Auto-pipeline toggle */}
      <div className="flex items-center justify-between glass-card p-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoPipelineEnabled}
            onChange={e => setAutoPipelineEnabled(e.target.checked)}
            className="w-4 h-4 rounded border-zinc-600 bg-zinc-700 text-blue-500 focus:ring-blue-500"
          />
          <span className="text-sm text-[var(--ctp-text)]">Auto-process pipeline</span>
          <span className="text-xs text-[var(--ctp-subtext)]">
            (Transcribe & highlights run automatically after upload)
          </span>
        </label>
      </div>

      <BreadcrumbSteppers />
      {/* Always show ingest */}
      <div className="glass-card p-5">
        <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest mb-4">Load Video</p>
        <StepIngest />
      </div>

      {source && (
        <div className="glass-card p-5 animate-fadeIn">
          <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest mb-4">Transcribe</p>
          <StepTranscribe />
        </div>
      )}

      {transcript && source && (
        <div className="glass-card p-5 animate-fadeIn">
          <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest mb-4">Find Viral Clips</p>
          <StepHighlights />
        </div>
      )}

      {clips && source && transcript && (
        <div className="glass-card p-5 animate-fadeIn">
          <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest mb-4">Review &amp; Render</p>
          <StepReview />
        </div>
      )}
    </div>
  )
}
