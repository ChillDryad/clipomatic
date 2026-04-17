import { useMemo } from 'react'

interface PasswordStrengthMeterProps {
  password: string
}

interface StrengthResult {
  score: number // 0-4
  label: string
  color: string
  requirements: {
    length: boolean
    uppercase: boolean
    lowercase: boolean
    number: boolean
    special: boolean
  }
}

function calculateStrength(password: string): StrengthResult {
  const requirements = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(password),
  }

  const metCount = Object.values(requirements).filter(Boolean).length

  let score = 0
  if (password.length >= 8) score = 1
  if (password.length >= 12) score = 2
  if (metCount >= 4) score = 3
  if (metCount === 5 && password.length >= 12) score = 4

  const strengthLevels: Record<number, { label: string; color: string }> = {
    0: { label: 'Enter password', color: 'var(--ctp-subtext)' },
    1: { label: 'Weak', color: 'var(--ctp-red)' },
    2: { label: 'Fair', color: 'var(--ctp-orange)' },
    3: { label: 'Good', color: 'var(--ctp-green)' },
    4: { label: 'Strong', color: 'var(--ctp-green)' },
  }

  return {
    score,
    label: strengthLevels[score].label,
    color: strengthLevels[score].color,
    requirements,
  }
}

export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  const strength = useMemo(() => calculateStrength(password), [password])

  const segments = [0, 1, 2, 3]

  return (
    <div className="space-y-2">
      {/* Strength bar */}
      <div className="flex gap-1">
        {segments.map((index) => (
          <div
            key={index}
            className="h-1 flex-1 rounded-full transition-all duration-300"
            style={{
              backgroundColor:
                index <= strength.score - 1
                  ? strength.color
                  : 'var(--ctp-surface-2)',
              opacity: index <= strength.score - 1 ? 1 : 0.3,
            }}
          />
        ))}
      </div>

      {/* Strength label */}
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-medium transition-colors duration-300"
          style={{ color: strength.color }}
        >
          {strength.label}
        </span>
      </div>

      {/* Requirements checklist */}
      {password.length > 0 && (
        <div className="grid grid-cols-2 gap-1 mt-2">
          <RequirementItem
            met={strength.requirements.length}
            label="8+ characters"
          />
          <RequirementItem
            met={strength.requirements.uppercase}
            label="Uppercase letter"
          />
          <RequirementItem
            met={strength.requirements.lowercase}
            label="Lowercase letter"
          />
          <RequirementItem met={strength.requirements.number} label="Number" />
          <RequirementItem
            met={strength.requirements.special}
            label="Special character"
          />
        </div>
      )}
    </div>
  )
}

interface RequirementItemProps {
  met: boolean
  label: string
}

function RequirementItem({ met, label }: RequirementItemProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <svg
        className={`w-3.5 h-3.5 transition-colors duration-300 ${
          met ? 'text-[var(--ctp-green)]' : 'text-[var(--ctp-subtext)]'
        }`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={3}
      >
        {met ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        )}
      </svg>
      <span
        className={`transition-colors duration-300 ${
          met ? 'text-[var(--ctp-text)]' : 'text-[var(--ctp-subtext)]'
        }`}
      >
        {label}
      </span>
    </div>
  )
}
