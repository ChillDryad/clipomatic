import type { HTMLAttributes } from 'react'

interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  progress: number // 0–1
  label?: string
}

export function ProgressBar({ progress, label, className = '', ...props }: ProgressBarProps) {
  const pct = Math.min(Math.max(progress, 0), 1) * 100
  return (
    <div {...props} className={`space-y-1.5 ${className}`}>
      {label && (
        <div className="flex justify-between text-xs text-[var(--ctp-subtext)]">
          <span>{label}</span>
          <span className="font-mono">{Math.round(pct)}%</span>
        </div>
      )}
      <div className="glass-progress-track">
        <div className="glass-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
