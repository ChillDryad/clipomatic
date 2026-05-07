import { usePipeline, type Step } from '../../context/PipelineContext'

const STEP_ICONS: Record<string, string> = {
  ingest: '📥',
  transcribe: '🎙️',
  highlights: '✨',
  review: '🌸',
}

const STEPS: { id: Step; label: string }[] = [
  { id: 'ingest', label: 'Load' },
  { id: 'transcribe', label: 'Transcribe' },
  { id: 'highlights', label: 'Find Clips' },
  { id: 'review', label: 'Render' },
]

export function BreadcrumbSteppers() {
  const { step, completedSteps, navigateTo } = usePipeline()

  return (
    <div className="flex items-center justify-center gap-0 py-4">
      {STEPS.map((s, i) => {
        const isDone = completedSteps.has(s.id)
        const isActive = step === s.id

        return (
          <div key={s.id} className="flex items-center">
            {/* Step dot + label */}
            <button
              onClick={() => isDone && navigateTo(s.id)}
              disabled={!isDone && !isActive}
              className={`
                flex flex-col items-center gap-1.5
                ${isDone ? 'cursor-pointer' : isActive ? 'cursor-default' : 'cursor-not-allowed opacity-40'}
              `}
            >
              {/* Themed icon */}
              <div
                className={`
                  w-10 h-10 rounded-full flex items-center justify-center text-base
                  border-2 transition-all
                  ${isDone ? 'step-done' : isActive ? 'step-active' : 'step-pending'}
                `}
              >
                <span className={isDone ? '' : isActive ? '' : 'opacity-50'}>
                  {STEP_ICONS[s.id]}
                </span>
              </div>

              {/* Label — hidden on mobile */}
              <span className={`text-xs font-medium hidden md:block ${isActive ? 'text-[var(--ctp-text)]' : 'text-[var(--ctp-subtext)]'}`}>
                {s.label}
              </span>
            </button>

            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div
                className={`h-0.5 w-8 sm:w-12 mx-1 md:mx-2 transition-colors ${
                  isDone ? 'bg-[var(--momiji-neon-green)]' : 'bg-[var(--ctp-overlay)]'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
