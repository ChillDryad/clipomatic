import { usePipeline, type Step } from '../../context/PipelineContext'

const STEPS: { id: Step; label: string }[] = [
  { id: 'ingest', label: 'Ingest' },
  { id: 'transcribe', label: 'Transcribe' },
  { id: 'highlights', label: 'Highlights' },
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
              {/* Circle */}
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold
                  border-2 transition-all
                  ${isDone ? 'breadcrumb-dot-done' : isActive ? 'breadcrumb-dot-active' : 'breadcrumb-dot-pending'}
                `}
              >
                {isDone ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>

              {/* Label — hidden on mobile */}
              <span className={`text-xs font-medium hidden md:block ${isActive ? 'text-[var(--ctp-text)]' : 'text-[var(--ctp-subtext)]'}`}>
                {s.label}
              </span>
            </button>

            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div
                className={`h-px w-8 sm:w-12 mx-1 md:mx-2 transition-colors ${
                  isDone ? 'bg-[var(--ctp-green)]' : 'bg-[var(--ctp-overlay)]'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
