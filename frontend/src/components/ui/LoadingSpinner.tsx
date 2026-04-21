interface LoadingSpinnerProps {
  label?: string
}

export function LoadingSpinner({ label = 'Loading...' }: LoadingSpinnerProps) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="relative w-16 h-16 mx-auto">
          <div className="absolute inset-0 rounded-full border-4 border-[var(--ctp-mauve-20)]" />
          <div className="absolute inset-0 rounded-full border-4 border-[var(--ctp-mauve)] border-t-transparent animate-spin" />
        </div>
        <p className="text-[var(--ctp-subtext)] animate-pulse">{label}</p>
      </div>
    </div>
  )
}
