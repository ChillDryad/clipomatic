interface Props {
  progress: number   // 0–1
  label: string
}

export function ProgressBar({ progress, label }: Props) {
  const pct = Math.min(Math.max(progress * 100, 0), 100)
  return (
    <div className="space-y-1">
      <div className="liquid-progress-track">
        <div
          className="liquid-progress-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-[var(--ctp-subtext)] italic">{label}</p>
    </div>
  )
}
