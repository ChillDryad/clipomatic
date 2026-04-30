import { usePipeline } from '../context/PipelineContext'
import { StepIngest } from '../components/steps/StepIngest'
import { StepTranscribe } from '../components/steps/StepTranscribe'
import { StepHighlights } from '../components/steps/StepHighlights'
import { StepReview } from '../components/steps/StepReview'
import { BreadcrumbSteppers } from '../components/layout/BreadcrumbSteppers'

export function PipelinePage() {
  const { step, source, transcript, clips } = usePipeline()

  return (
    <div className="space-y-6">
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
