import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { useTheme } from '../../hooks/useTheme'
import { usePipeline } from '../../context/PipelineContext'
import { fetchModels, saveConfig } from '../../api'

const WHISPER_MODELS = [
  { value: 'tiny', label: 'tiny — fastest, lowest accuracy' },
  { value: 'base', label: 'base — fast, basic accuracy' },
  { value: 'small', label: 'small — good balance (default)' },
  { value: 'medium', label: 'medium — better accuracy' },
  { value: 'large-v3-turbo', label: 'large-v3-turbo — great accuracy, faster than v3' },
  { value: 'large-v3', label: 'large-v3 — best accuracy, slowest' },
]

const WHISPER_DEVICES = [
  { value: 'auto', label: 'auto' },
  { value: 'cuda', label: 'cuda' },
  { value: 'cpu', label: 'cpu' },
]

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { theme } = useTheme()
  const {
    config,
    setConfig,
    availableModels,
    setAvailableModels,
    fetchingModels,
    setFetchingModels,
    modelFetchError,
    setModelFetchError,
  } = usePipeline()

  // Config is loaded automatically on app mount by PipelineContext
  // This effect is kept for backwards compatibility if settings are changed while modal is open

  const handleFetchModels = async () => {
    setFetchingModels(true)
    setModelFetchError(null)
    try {
      const models = await fetchModels()
      setAvailableModels(models)
      if (models.length > 0 && !models.includes(config.llmModel)) {
        setConfig({ llmModel: models[0] })
      }
    } catch (err) {
      setModelFetchError(String(err))
    } finally {
      setFetchingModels(false)
    }
  }

  const handleConfigChange = async (key: string, value: string) => {
    // Update local state immediately for responsive UI
    setConfig({ [key]: value })
    // Persist to backend
    try {
      await saveConfig({ [key]: value })
    } catch (err) {
      console.error('Failed to save config:', err)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <div className="space-y-5">
        {/* Whisper section */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">Whisper</p>
          <Select
            label="Model"
            value={config.whisperModel}
            onChange={e => handleConfigChange('whisper_model', e.target.value)}
            options={WHISPER_MODELS}
          />
          <Select
            label="Device"
            value={config.whisperDevice}
            onChange={e => handleConfigChange('whisper_device', e.target.value)}
            options={WHISPER_DEVICES}
          />
        </div>

        {/* LLM section */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">LLM</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleFetchModels}
            loading={fetchingModels}
          >
            {fetchingModels ? 'Fetching…' : 'Fetch models'}
          </Button>
          {modelFetchError && (
            <p className="text-xs text-[var(--ctp-red)]">{modelFetchError}</p>
          )}
          {availableModels.length > 0 ? (
            <Select
              label="Model"
              value={config.llmModel}
              onChange={e => handleConfigChange('llm_model', e.target.value)}
              options={availableModels.map(m => ({ value: m, label: m }))}
            />
          ) : (
            <label className="space-y-1.5 block">
              <span className="text-xs text-[var(--ctp-subtext)] font-medium">Model name</span>
              <input
                type="text"
                value={config.llmModel}
                onChange={e => handleConfigChange('llm_model', e.target.value)}
                placeholder="e.g. llama3.2"
                className="glass-input w-full px-3 py-2 text-sm text-[var(--ctp-text)]"
              />
            </label>
          )}
        </div>
      </div>
    </Modal>
  )
}
