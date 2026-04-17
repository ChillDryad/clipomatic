import type { InputHTMLAttributes } from 'react'

interface ColorPickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
}

export function ColorPicker({ label, className = '', id, value, ...props }: ColorPickerProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <label className="space-y-1.5 block">
      {label && (
        <span className="text-xs text-[var(--ctp-subtext)] font-medium">{label}</span>
      )}
      <div className="flex items-center gap-2">
        <input
          type="color"
          id={inputId}
          className={className}
          value={value}
          {...props}
        />
        <span className="text-xs text-[var(--ctp-subtext)] font-mono">{value}</span>
      </div>
    </label>
  )
}
