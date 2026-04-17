import type { SelectHTMLAttributes } from 'react'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: { value: string; label: string }[]
}

export function Select({ label, options, className = '', id, ...props }: SelectProps) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <label className="space-y-1.5 block">
      {label && (
        <span className="text-xs text-[var(--ctp-subtext)] font-medium">{label}</span>
      )}
      <select
        id={selectId}
        className={`glass-select w-full px-3 py-2 text-sm text-[var(--ctp-text)] ${className}`}
        {...props}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  )
}
