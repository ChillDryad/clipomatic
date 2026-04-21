import type { SelectHTMLAttributes, ReactNode } from 'react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: SelectOption[]
  error?: string
  hint?: string
  placeholder?: string
  icon?: ReactNode
  fullWidth?: boolean
}

/**
 * Reusable Select component with label, error states, and optional icons.
 *
 * @example
 * ```tsx
 * <Select
 *   label="Quality"
 *   options={[
 *     { value: 'low', label: 'Low (480p)' },
 *     { value: 'medium', label: 'Medium (720p)' },
 *     { value: 'high', label: 'High (1080p)' },
 *   ]}
 * />
 * ```
 */
export function Select({
  label,
  options,
  error,
  hint,
  icon,
  placeholder,
  className = '',
  id,
  fullWidth = true,
  ...props
}: SelectProps) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-')
  const errorId = error ? `${selectId}-error` : undefined
  const hintId = hint ? `${selectId}-hint` : undefined

  return (
    <div className={`space-y-1.5 ${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label htmlFor={selectId} className="text-xs text-[var(--ctp-subtext)] font-medium block">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ctp-subtext)] pointer-events-none">
            {icon}
          </span>
        )}
        <select
          id={selectId}
          className={`
            glass-select px-3 py-2 text-sm text-[var(--ctp-text)] rounded-lg
            appearance-none cursor-pointer
            ${icon ? 'pl-10' : ''}
            ${error ? 'border-[var(--ctp-red)] focus:border-[var(--ctp-red)]' : ''}
            ${fullWidth ? 'w-full' : ''}
            ${className}
          `}
          aria-invalid={!!error}
          aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
          {...props}
        >
          {placeholder && (
            <option value="" disabled hidden>{placeholder}</option>
          )}
          {options.map(opt => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ctp-subtext)] pointer-events-none">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </div>
      {hint && !error && (
        <p id={hintId} className="text-xs text-[var(--ctp-subtext)]">{hint}</p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-[var(--ctp-red)]" role="alert">{error}</p>
      )}
    </div>
  )
}
