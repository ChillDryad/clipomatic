import type { InputHTMLAttributes, ReactNode } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  icon?: ReactNode
  leftAddon?: ReactNode
  rightAddon?: ReactNode
  fullWidth?: boolean
}

/**
 * Reusable Input component with label, error states, and optional icons/addons.
 *
 * @example
 * ```tsx
 * <Input label="Email" type="email" placeholder="you@example.com" />
 * <Input label="Search" icon={<SearchIcon />} placeholder="Search..." />
 * <Input label="Price" leftAddon="$" rightAddon="USD" />
 * <Input label="Password" error="Password must be 8+ characters" />
 * ```
 */
export function Input({
  label,
  error,
  hint,
  icon,
  leftAddon,
  rightAddon,
  className = '',
  id,
  fullWidth = true,
  ...props
}: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  const errorId = error ? `${inputId}-error` : undefined
  const hintId = hint ? `${inputId}-hint` : undefined

  return (
    <div className={`space-y-1.5 ${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label htmlFor={inputId} className="text-xs text-[var(--ctp-subtext)] font-medium block">
          {label}
        </label>
      )}
      <div className={`relative flex items-center ${className}`}>
        {leftAddon && (
          <span className="absolute left-3 text-[var(--ctp-subtext)] text-sm pointer-events-none">
            {leftAddon}
          </span>
        )}
        {icon && (
          <span className={`absolute left-3 text-[var(--ctp-subtext)] ${leftAddon ? 'ml-5' : ''}`}>
            {icon}
          </span>
        )}
        <input
          id={inputId}
          className={`
            glass-input px-3 py-2 text-sm text-[var(--ctp-text)] rounded-lg
            ${(icon || leftAddon) ? 'pl-10' : ''}
            ${rightAddon ? 'pr-10' : ''}
            ${error ? 'border-[var(--ctp-red)] focus:border-[var(--ctp-red)]' : ''}
            ${fullWidth ? 'w-full' : ''}
          `}
          aria-invalid={!!error}
          aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
          {...props}
        />
        {rightAddon && (
          <span className="absolute right-3 text-[var(--ctp-subtext)] text-sm pointer-events-none">
            {rightAddon}
          </span>
        )}
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
