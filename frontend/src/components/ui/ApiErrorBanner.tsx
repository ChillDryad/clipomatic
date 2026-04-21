interface ApiErrorBannerProps {
  error: { message: string; suggestion?: string }
  onRetry: () => void
  retryLabel?: string
  disabled?: boolean
}

export function ApiErrorBanner({ error, onRetry, retryLabel = 'Retry', disabled }: ApiErrorBannerProps) {
  return (
    <div className="mt-3 glass-card p-3 border-l-4 border-[var(--ctp-red)]">
      <div className="flex items-start gap-3">
        <svg className="w-5 h-5 text-[var(--ctp-red)] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div className="flex-1">
          <p className="text-sm font-semibold text-[var(--ctp-red)] mb-1">{error.message}</p>
          {error.suggestion && (
            <p className="text-xs text-[var(--ctp-subtext)] mb-2">{error.suggestion}</p>
          )}
          <button
            onClick={onRetry}
            disabled={disabled}
            className="text-xs text-[var(--ctp-blue)] hover:text-[var(--ctp-text)] flex items-center gap-1 disabled:opacity-50"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {retryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
