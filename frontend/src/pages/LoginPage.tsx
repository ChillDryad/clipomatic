import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { OAuthButtons } from '../components/auth/OAuthButtons'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { login, isAuthenticated, error: authError } = useAuth()
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
    setIsSubmitting(true)

    try {
      await login(email, password)
      navigate(redirectPath, { replace: true })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Login failed')
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
    <div className="min-h-screen flex items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Animated background decorations */}
      <div className="fixed inset-0 pointer-events-none">
        {/* Top-right gradient orb */}
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-gradient-to-br from-[var(--ctp-mauve)]/20 to-[var(--ctp-blue)]/20 blur-3xl animate-pulse" />
        {/* Bottom-left gradient orb */}
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-gradient-to-tr from-[var(--ctp-peach)]/20 to-[var(--ctp-yellow)]/20 blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        {/* Center accent */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-gradient-to-r from-[var(--ctp-mauve-10)] to-[var(--ctp-blue-10)] blur-3xl opacity-50" />
      </div>

      {/* Main card */}
      <div className="glass-card p-8 w-full max-w-md relative z-10 backdrop-blur-2xl">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--ctp-mauve-20)] to-[var(--ctp-blue-20)] mb-4 shadow-lg">
            <svg className="w-9 h-9 text-[var(--ctp-mauve)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[var(--ctp-text)] mb-2">Welcome back</h1>
          <p className="text-[var(--ctp-subtext)]">Sign in to continue to Momiji Clipper</p>
        </div>

        {/* Error display */}
        {errorMessage && (
          <div className="mb-6 p-4 rounded-xl bg-[var(--ctp-red-20)] border border-[var(--ctp-red-30)] flex items-start gap-3 animate-shake">
            <svg className="w-5 h-5 text-[var(--ctp-red)] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-[var(--ctp-red)]">{errorMessage}</p>
          </div>
        )}

        {/* Email/Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4 mb-6" noValidate>
          <div className="space-y-1">
            <label htmlFor="email" className="block text-xs font-medium text-[var(--ctp-subtext)] ml-1">
              Email address
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              className="h-12"
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="password" className="block text-xs font-medium text-[var(--ctp-subtext)] ml-1">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
              className="h-12"
              disabled={isSubmitting}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            className="w-full h-12 text-base font-semibold shadow-lg hover:shadow-xl transition-all"
            loading={isSubmitting}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Signing in...
              </span>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>

        {/* Divider */}
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--ctp-overlay)]/50" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-[var(--glass-bg)] px-4 text-[var(--ctp-subtext)] font-medium">
              Or continue with
            </span>
          </div>
        </div>

        {/* OAuth Buttons */}
        <div className="mb-6">
          <OAuthButtons onAuth={handleOAuth} />
        </div>

        {/* Register link */}
        <p className="text-center text-sm text-[var(--ctp-subtext)]">
          Don't have an account?{' '}
          <Link to="/register" className="text-[var(--ctp-mauve)] hover:underline font-semibold transition-colors">
            Create free account
          </Link>
        </p>
      </div>

      {/* Footer */}
      <div className="fixed bottom-4 left-0 right-0 text-center z-10">
        <Link to="/" className="inline-flex items-center gap-2 text-xs text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)] transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to home
        </Link>
      </div>
    </div>
  )
}
