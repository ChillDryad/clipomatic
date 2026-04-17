import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

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
        <div className="space-y-3 mb-6">
          <Button
            type="button"
            variant="secondary"
            className="w-full h-12 hover:border-[var(--ctp-blue)] hover:bg-[var(--ctp-blue-10)] transition-all"
            onClick={() => handleOAuth('google')}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            }
          >
            Continue with Google
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full h-12 hover:border-[var(--ctp-peach)] hover:bg-[var(--ctp-peach-10)] transition-all"
            onClick={() => handleOAuth('twitch')}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0h1.714v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
              </svg>
            }
          >
            Continue with Twitch
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full h-12 hover:border-[var(--ctp-red)] hover:bg-[var(--ctp-red-10)] transition-all"
            onClick={() => handleOAuth('youtube')}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
            }
          >
            Continue with YouTube
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full h-12 hover:border-[#fe2C55] hover:bg-[#fe2C55]/10 transition-all"
            onClick={() => handleOAuth('tiktok')}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93v6.16c0 2.52-1.12 4.84-2.9 6.24-1.72 1.39-3.92 1.98-6.09 1.66-2.18-.32-4.2-1.55-5.47-3.37-1.27-1.82-1.68-4.15-1.12-6.33.56-2.18 2.03-4.02 4.02-5.06 1.99-1.04 4.36-1.06 6.37-.06v4.12c-.69-.45-1.51-.66-2.33-.59-.82.07-1.59.43-2.17 1.01-.58.58-.94 1.35-1.01 2.17-.07.82.14 1.64.59 2.33.45.69 1.13 1.2 1.92 1.42.79.22 1.64.13 2.37-.25.73-.38 1.3-1.01 1.59-1.78.29-.77.27-1.62-.06-2.37V.02z"/>
              </svg>
            }
          >
            Continue with TikTok
          </Button>
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
