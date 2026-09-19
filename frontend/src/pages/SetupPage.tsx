import { useState } from 'react'
import { setup, testProvider, type LlmProvider, type ProviderSettings } from '../api'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

const providerDefaults: Record<LlmProvider, Pick<ProviderSettings, 'base_url' | 'llm_model'>> = {
  ollama: { base_url: 'http://ollama:11434/v1', llm_model: 'llama3.1:8b' },
  openai: { base_url: 'https://api.openai.com/v1', llm_model: 'gpt-4o-mini' },
}

const providerOptions: Array<{ value: LlmProvider; title: string; description: string }> = [
  { value: 'ollama', title: 'Ollama', description: 'Run local models on this server' },
  { value: 'openai', title: 'OpenAI', description: 'Use your OpenAI API key' },
]

export function SetupPage() {
  const { setUser } = useAuth()
  const [provider, setProvider] = useState<LlmProvider>('ollama')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [baseUrl, setBaseUrl] = useState(providerDefaults.ollama.base_url)
  const [apiKey, setApiKey] = useState('')
  const [llmModel, setLlmModel] = useState(providerDefaults.ollama.llm_model)
  const [highlightModel, setHighlightModel] = useState('')
  const [visionModel, setVisionModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const providerSettings = (): ProviderSettings => ({
    provider,
    base_url: baseUrl.trim(),
    ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
    llm_model: llmModel.trim(),
    ...(highlightModel.trim() ? { highlight_model: highlightModel.trim() } : {}),
    ...(visionModel.trim() ? { vision_model: visionModel.trim() } : {}),
  })

  const selectProvider = (nextProvider: LlmProvider) => {
    setProvider(nextProvider)
    setBaseUrl(providerDefaults[nextProvider].base_url)
    setLlmModel(providerDefaults[nextProvider].llm_model)
    setApiKey('')
    setModels([])
    setConnectionMessage(null)
  }

  const handleTest = async () => {
    setError(null)
    setConnectionMessage(null)
    if (!baseUrl.trim() || !llmModel.trim()) {
      setError('Add an endpoint and model before testing the connection.')
      return
    }
    if (provider === 'openai' && !apiKey.trim()) {
      setError('An OpenAI API key is required to test this connection.')
      return
    }

    setIsTesting(true)
    try {
      const result = await testProvider(providerSettings())
      setModels(result.models)
      setConnectionMessage(result.models.length ? `Connected — found ${result.models.length} model${result.models.length === 1 ? '' : 's'}.` : 'Connected successfully.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to this provider.')
    } finally {
      setIsTesting(false)
    }
  }

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
    if (!baseUrl.trim() || !llmModel.trim()) {
      setError('An endpoint and primary model are required.')
      return
    }
    if (provider === 'openai' && !apiKey.trim()) {
      setError('An OpenAI API key is required.')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await setup({
        email: email.trim(),
        password,
        ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
        ...providerSettings(),
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

  const apiKeyRequired = provider === 'openai'

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
          <p className="mt-2 text-[var(--ctp-subtext)]">Create the owner account and connect the AI that will find your best clips.</p>
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
            <div className="mb-4 flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ctp-mauve)] text-sm font-bold text-[var(--ctp-base)]">2</span><div><h2 className="font-semibold text-[var(--ctp-text)]">AI provider</h2><p className="text-sm text-[var(--ctp-subtext)]">You can update these details later in settings.</p></div></div>
            <div className="grid gap-3 sm:grid-cols-3">
              {providerOptions.map(option => <button key={option.value} type="button" onClick={() => selectProvider(option.value)} className={`rounded-xl border p-4 text-left transition-colors ${provider === option.value ? 'border-[var(--ctp-mauve)] bg-[var(--ctp-mauve-10)] ring-1 ring-[var(--ctp-mauve)]' : 'border-[var(--ctp-overlay)] hover:border-[var(--ctp-mauve)]'}`}><span className="block font-semibold text-[var(--ctp-text)]">{option.title}</span><span className="mt-1 block text-xs text-[var(--ctp-subtext)]">{option.description}</span></button>)}
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Input label="Base URL" type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" required />
              <Input label={`API key${apiKeyRequired ? '' : ' (optional)'}`} type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={apiKeyRequired ? 'sk-...' : 'Leave blank if not needed'} required={apiKeyRequired} autoComplete="off" />
              <div className="sm:col-span-2"><Input label="Primary model" value={llmModel} onChange={event => setLlmModel(event.target.value)} placeholder="e.g. llama3.1:8b" required list="provider-models" />{models.length > 0 && <datalist id="provider-models">{models.map(model => <option key={model} value={model} />)}</datalist>}</div>
              <Input label="Highlight model (optional)" value={highlightModel} onChange={event => setHighlightModel(event.target.value)} placeholder="Uses primary model when empty" list="provider-models" />
              <Input label="Vision model (optional)" value={visionModel} onChange={event => setVisionModel(event.target.value)} placeholder="Uses primary model when empty" list="provider-models" />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3"><Button type="button" variant="secondary" onClick={handleTest} loading={isTesting} disabled={isTesting}>{isTesting ? 'Testing connection...' : 'Test connection'}</Button>{connectionMessage && <span className="text-sm text-[var(--ctp-green)]">{connectionMessage}</span>}</div>
          </section>

          <div className="flex items-center justify-between border-t border-[var(--ctp-overlay)] pt-6"><p className="max-w-sm text-xs text-[var(--ctp-subtext)]">Your API key is sent only to your server and is never returned to this browser.</p><Button type="submit" variant="primary" loading={isSubmitting} disabled={isSubmitting}>{isSubmitting ? 'Finishing setup...' : 'Finish setup'}</Button></div>
        </form>
      </div>
    </main>
  )
}
