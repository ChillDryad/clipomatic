import type { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, className = '', id, ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <label className="space-y-1.5 block">
      {label && (
        <span className="text-xs text-[var(--ctp-subtext)] font-medium">{label}</span>
      )}
      <input
        id={inputId}
        className={`glass-input w-full px-3 py-2 text-sm text-[var(--ctp-text)] ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-[var(--ctp-red)]">{error}</span>}
    </label>
  )
}
