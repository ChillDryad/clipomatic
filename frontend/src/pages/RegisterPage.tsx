import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { OAuthButtons } from '../components/auth/OAuthButtons'
import { PasswordStrengthMeter } from '../components/ui/PasswordStrengthMeter'

export function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { register, isAuthenticated, error: authError } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const redirectPath = searchParams.get('redirect') || '/dashboard'

  // OAuth callback is handled automatically by backend setting HttpOnly cookie
  // and redirecting to /dashboard - no client-side token handling needed

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate(redirectPath, { replace: true })
    }
  }, [isAuthenticated, navigate, redirectPath])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    // Validation
    if (password !== confirmPassword) {
      setFormError('Passwords do not match')
      return
    }

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters')
      return
    }

    // Check password strength (require at least 3 requirements met)
    const hasUppercase = /[A-Z]/.test(password)
    const hasLowercase = /[a-z]/.test(password)
    const hasNumber = /[0-9]/.test(password)
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password)
    const metCount = [password.length >= 8, hasUppercase, hasLowercase, hasNumber, hasSpecial].filter(Boolean).length

    if (metCount < 4) {
      setFormError('Password must include uppercase, lowercase, number, and special character')
      return
    }

    setIsSubmitting(true)

    try {
      await register(email, password, displayName || undefined)
      navigate(redirectPath, { replace: true })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOAuth = (provider: string) => {
    const redirectUri = encodeURIComponent(window.location.origin + '/api/auth/callback')
    window.location.href = `/api/auth/${provider}/authorize?redirect_uri=${redirectUri}`
  }

  const errorMessage = formError || authError

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="glass-card p-8 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[var(--ctp-text)] mb-2">Create an account</h1>
          <p className="text-[var(--ctp-subtext)]">Get started with Momiji Clipper</p>
        </div>

        {/* Error display */}
        {errorMessage && (
          <div className="mb-6 p-4 rounded-lg bg-[var(--ctp-red-20)] border border-[var(--ctp-red-30)]">
            <p className="text-sm text-[var(--ctp-red)]">{errorMessage}</p>
          </div>
        )}

        {/* Email/Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4 mb-6" noValidate>
          <Input
            label="Display name (optional)"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
          <div className="space-y-1">
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <PasswordStrengthMeter password={password} />
          </div>
          <Input
            label="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter your password"
            required
            autoComplete="new-password"
          />
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={isSubmitting}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creating account...' : 'Create account'}
          </Button>
        </form>

        {/* Divider */}
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--ctp-overlay)]" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-[var(--glass-bg)] px-2 text-[var(--ctp-subtext)]">
              Or continue with
            </span>
          </div>
        </div>

        {/* OAuth Buttons */}
        <div className="mb-6">
          <OAuthButtons onAuth={handleOAuth} />
        </div>

        {/* Login link */}
        <p className="text-center text-sm text-[var(--ctp-subtext)]">
          Already have an account?{' '}
          <Link to="/login" className="text-[var(--ctp-mauve)] hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
