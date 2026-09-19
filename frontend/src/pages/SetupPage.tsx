import { useEffect, useState } from 'react'
import { getSetupOllamaModels, setup } from '../api'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

const ollamaBaseUrl = 'http://ollama:11434/v1'

export function SetupPage() {
  const { setUser } = useAuth()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [llmModel, setLlmModel] = useState('')
  const [highlightModel, setHighlightModel] = useState('')
  const [visionModel, setVisionModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelError, setModelError] = useState<string | null>(null)
  const [isLoadingModels, setIsLoadingModels] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const loadModels = async () => {
    setIsLoadingModels(true)
    setModelError(null)
    try {
      const { models: nextModels } = await getSetupOllamaModels()
      setModels(nextModels)
      setLlmModel(current => nextModels.includes(current) ? current : (nextModels[0] ?? ''))
      setHighlightModel(current => nextModels.includes(current) ? current : (nextModels[0] ?? ''))
      setVisionModel(current => nextModels.includes(current) ? current : (nextModels[0] ?? ''))
      if (!nextModels.length) {
        setModelError('No local Ollama models are available. Pull a model with `ollama pull llama3.1:8b`, then refresh this list.')
      }
    } catch (err) {
      setModels([])
      setModelError(err instanceof Error ? `Could not load local Ollama models: ${err.message}` : 'Could not load local Ollama models. Verify Ollama is running, then refresh this list.')
    } finally {
      setIsLoadingModels(false)
    }
  }

  useEffect(() => {
    void loadModels()
  }, [])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (!models.length || !llmModel || !highlightModel || !visionModel) {
      setError('Pull a local Ollama model and select models before finishing setup.')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await setup({
        email: email.trim(),
        password,
        ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
        provider: 'ollama',
        base_url: 'http://ollama:11434/v1',
        llm_model: llmModel,
        highlight_model: highlightModel,
        vision_model: visionModel,
      })
      setUser(result.user)
      // SetupGate caches setup state for this initial render; reload so it
      // re-checks the completed installation before entering the app.
      window.location.replace('/clip-studio')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup could not be completed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const modelsUnavailable = isLoadingModels || !models.length

  return (
    <main className="min-h-screen px-4 py-8 sm:py-12 relative overflow-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-32 h-96 w-96 rounded-full bg-[var(--ctp-mauve-20)] blur-3xl" />
        <div className="absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-[var(--ctp-blue-20)] blur-3xl" />
      </div>
      <div className="relative z-10 mx-auto max-w-3xl">
        <header className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--ctp-mauve)] to-[var(--ctp-blue)] text-2xl shadow-lg">✦</div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ctp-mauve)]">Momiji Clipper</p>
          <h1 className="mt-2 text-3xl font-bold text-[var(--ctp-text)]">Set up your workspace</h1>
          <p className="mt-2 text-[var(--ctp-subtext)]">Create the owner account and choose the local Ollama models that will find your best clips.</p>
        </header>

        <form onSubmit={handleSubmit} className="glass-card p-5 sm:p-8 space-y-8" noValidate>
          {error && <div role="alert" className="rounded-xl border border-[var(--ctp-red-30)] bg-[var(--ctp-red-10)] p-3 text-sm text-[var(--ctp-red)]">{error}</div>}

          <section>
            <div className="mb-4 flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ctp-mauve)] text-sm font-bold text-[var(--ctp-base)]">1</span><div><h2 className="font-semibold text-[var(--ctp-text)]">Owner account</h2><p className="text-sm text-[var(--ctp-subtext)]">This account administers your new workspace.</p></div></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Display name (optional)" value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Your name" autoComplete="name" />
              <Input label="Email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required autoComplete="email" />
              <Input label="Password" type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" required minLength={8} autoComplete="new-password" />
              <Input label="Confirm password" type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Re-enter your password" required minLength={8} autoComplete="new-password" />
            </div>
          </section>

          <section className="border-t border-[var(--ctp-overlay)] pt-7">
            <div className="mb-4 flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ctp-mauve)] text-sm font-bold text-[var(--ctp-base)]">2</span><div><h2 className="font-semibold text-[var(--ctp-text)]">Local Ollama models</h2><p className="text-sm text-[var(--ctp-subtext)]">Using Ollama at {ollamaBaseUrl}.</p></div></div>
            {modelError && <div role="alert" className="mb-4 rounded-xl border border-[var(--ctp-red-30)] bg-[var(--ctp-red-10)] p-3 text-sm text-[var(--ctp-red)]">{modelError}</div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2 text-sm font-medium text-[var(--ctp-text)]">Primary model
                <select value={llmModel} onChange={event => setLlmModel(event.target.value)} disabled={modelsUnavailable} required className="mt-1 w-full rounded-lg border border-[var(--ctp-overlay)] bg-[var(--ctp-surface)] px-3 py-2 text-[var(--ctp-text)] disabled:cursor-not-allowed disabled:opacity-60">
                  {models.map(model => <option key={model} value={model}>{model}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-[var(--ctp-text)]">Highlight model
                <select value={highlightModel} onChange={event => setHighlightModel(event.target.value)} disabled={modelsUnavailable} required className="mt-1 w-full rounded-lg border border-[var(--ctp-overlay)] bg-[var(--ctp-surface)] px-3 py-2 text-[var(--ctp-text)] disabled:cursor-not-allowed disabled:opacity-60">
                  {models.map(model => <option key={model} value={model}>{model}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-[var(--ctp-text)]">Vision model
                <select value={visionModel} onChange={event => setVisionModel(event.target.value)} disabled={modelsUnavailable} required className="mt-1 w-full rounded-lg border border-[var(--ctp-overlay)] bg-[var(--ctp-surface)] px-3 py-2 text-[var(--ctp-text)] disabled:cursor-not-allowed disabled:opacity-60">
                  {models.map(model => <option key={model} value={model}>{model}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-4"><Button type="button" variant="secondary" onClick={() => void loadModels()} loading={isLoadingModels} disabled={isLoadingModels}>{isLoadingModels ? 'Loading models...' : 'Refresh models'}</Button></div>
          </section>

          <div className="flex items-center justify-end border-t border-[var(--ctp-overlay)] pt-6"><Button type="submit" variant="primary" loading={isSubmitting} disabled={isSubmitting || modelsUnavailable}>{isSubmitting ? 'Finishing setup...' : 'Finish setup'}</Button></div>
        </form>
      </div>
    </main>
  )
}
