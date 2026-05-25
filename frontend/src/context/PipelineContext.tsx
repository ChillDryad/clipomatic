import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react'
import type { Clip, Config, Source, Transcript } from '../types'
import { getConfig, fetchModels } from '../api'

export type Step = 'ingest' | 'transcribe' | 'highlights' | 'review'

interface PipelineContextValue {
  step: Step
  completedSteps: Set<Step>
  source: Source | null
  transcript: Transcript | null
  clips: Clip[] | null
  config: Config
  availableModels: string[]
  fetchingModels: boolean
  modelFetchError: string | null
  projectId: string | null
  setProjectId: (id: string | null) => void
  setSource: (s: Source, cachedTranscript: Transcript | null) => void
  setTranscript: (t: Transcript) => void
  setClips: (c: Clip[]) => void
  updateClip: (index: number, patch: Partial<Clip>) => void
  navigateTo: (s: Step) => void
  navigateBack: () => void
  reset: () => void
  setConfig: (partial: Partial<Config>) => void
  setAvailableModels: (models: string[]) => void
  setFetchingModels: (v: boolean) => void
  setModelFetchError: (e: string | null) => void
  renderedClips: Map<string, string>
  setRenderedClip: (clipKey: string, videoPath: string) => void
  improvedSegments: Map<string, Transcript>
  setImprovedSegments: (key: string, segments: Transcript) => void
  autoPipelineEnabled: boolean
  setAutoPipelineEnabled: (v: boolean) => void
  activeJobId: string | null
  setActiveJobId: (id: string | null) => void
}

const PipelineContext = createContext<PipelineContextValue | null>(null)

const STEP_ORDER: Step[] = ['ingest', 'transcribe', 'highlights', 'review']

export function PipelineProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>('ingest')
  const [completedSteps, setCompletedSteps] = useState<Set<Step>>(new Set())

  const [source, setSourceState] = useState<Source | null>(null)
  const [transcript, setTranscriptState] = useState<Transcript | null>(null)
  const [clips, setClipsState] = useState<Clip[] | null>(null)

  const [config, setConfigState] = useState<Config>({
    whisperModel: 'large-v3',
    whisperDevice: 'auto',
    llmModel: '',
    llmBaseUrl: '',
  })

  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelFetchError, setModelFetchError] = useState<string | null>(null)

  // Load config and models from backend on mount
  useEffect(() => {
    let mounted = true
    const loadConfig = async () => {
      try {
        const cfg = await getConfig()
        if (mounted) {
          setConfigState(prev => ({
            ...prev,
            whisperModel: cfg.whisper_model || prev.whisperModel,
            whisperDevice: cfg.whisper_device || prev.whisperDevice,
            llmModel: cfg.llm_model || prev.llmModel,
            llmBaseUrl: cfg.llm_base_url || prev.llmBaseUrl,
          }))
        }
      } catch (err) {
        console.error('Failed to load config:', err)
      }
    }
    const loadModels = async () => {
      try {
        setFetchingModels(true)
        const models = await fetchModels()
        if (mounted) {
          setAvailableModels(models)
          setModelFetchError(null)
        }
      } catch (err) {
        if (mounted) {
          setModelFetchError(String(err))
        }
      } finally {
        if (mounted) {
          setFetchingModels(false)
        }
      }
    }
    loadConfig()
    loadModels()
    return () => { mounted = false }
  }, [])
  const [renderedClips, setRenderedClipsState] = useState<Map<string, string>>(new Map())
  const [improvedSegments, setImprovedSegmentsState] = useState<Map<string, Transcript>>(new Map())
  const [projectId, setProjectIdState] = useState<string | null>(null)
  const [autoPipelineEnabled, setAutoPipelineEnabledState] = useState<boolean>(
    localStorage.getItem('autoPipelineEnabled') === 'true'
  )
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

  const updateClip = useCallback((index: number, patch: Partial<Clip>) => {
    setClipsState(prev => {
      if (!prev) return prev
      const next = [...prev]
      next[index] = { ...next[index], ...patch }
      return next
    })
  }, [])

  const setRenderedClip = useCallback((clipKey: string, videoPath: string) => {
    setRenderedClipsState(prev => new Map(prev).set(clipKey, videoPath))
  }, [])

  const setImprovedSegments = useCallback((key: string, segments: Transcript) => {
    setImprovedSegmentsState(prev => new Map(prev).set(key, segments))
  }, [])

  const setSource = useCallback((s: Source, cachedTranscript: Transcript | null) => {
    setSourceState(s)
    setTranscriptState(cachedTranscript)
    setClipsState(null)
    setStep('transcribe')
    setCompletedSteps(prev => new Set([...prev, 'ingest']))
  }, [])

  const setTranscript = useCallback((t: Transcript) => {
    setTranscriptState(t)
    setClipsState(null)
    setStep('highlights')
    setCompletedSteps(prev => new Set([...prev, 'transcribe']))
  }, [])

  const setClips = useCallback((c: Clip[]) => {
    setClipsState(c)
    setStep('review')
    setCompletedSteps(prev => new Set([...prev, 'highlights']))
  }, [])

  const navigateTo = useCallback((s: Step) => {
    setStep(s)
    setCompletedSteps(prev => new Set([...prev, s]))
  }, [])

  const navigateBack = useCallback(() => {
    const idx = STEP_ORDER.indexOf(step)
    if (idx > 0) {
      const prev = STEP_ORDER[idx - 1]
      setStep(prev)
    }
  }, [step])

  const reset = useCallback(() => {
    setSourceState(null)
    setTranscriptState(null)
    setClipsState(null)
    setStep('ingest')
    setCompletedSteps(new Set())
  }, [])

  const setConfig = useCallback((partial: Partial<Config>) => {
    setConfigState(prev => ({ ...prev, ...partial }))
  }, [])

  const setAutoPipelineEnabled = useCallback((v: boolean) => {
    localStorage.setItem('autoPipelineEnabled', String(v))
    setAutoPipelineEnabledState(v)
  }, [])

  const setProjectId = useCallback((id: string | null) => {
    setProjectIdState(id)
  }, [])

  // Auto-enqueue when auto-pipeline is enabled and a new project is loaded
  useEffect(() => {
    if (!autoPipelineEnabled || !projectId || !source || activeJobId) return
    // Skip if transcript already exists (project was restored)
    if (transcript) return

    const doEnqueue = async () => {
      try {
        const { enqueuePipelineJob } = await import('../api')
        const result = await enqueuePipelineJob({
          project_id: projectId,
          steps: ['transcribe', 'highlights'],
          config: {
            whisper_model: config.whisperModel,
            device: config.whisperDevice,
            llm_model: config.llmModel,
          },
        })
        setActiveJobId(result.job_id)
      } catch (err) {
        console.error('Auto-enqueue failed:', err)
      }
    }
    doEnqueue()
  }, [autoPipelineEnabled, projectId, source, activeJobId, config.whisperModel, config.whisperDevice, config.llmModel])

  return (
    <PipelineContext.Provider
      value={{
        step,
        completedSteps,
        source,
        transcript,
        clips,
        config,
        availableModels,
        fetchingModels,
        modelFetchError,
        setSource,
        setTranscript,
        setClips,
        updateClip,
        navigateTo,
        navigateBack,
        reset,
        setConfig,
        setAvailableModels,
        setFetchingModels,
        setModelFetchError,
        renderedClips,
        setRenderedClip,
        improvedSegments,
        setImprovedSegments,
        projectId,
        setProjectId,
        autoPipelineEnabled,
        setAutoPipelineEnabled,
        activeJobId,
        setActiveJobId,
      }}
    >
      {children}
    </PipelineContext.Provider>
  )
}

export function usePipeline() {
  const ctx = useContext(PipelineContext)
  if (!ctx) throw new Error('usePipeline must be used within PipelineProvider')
  return ctx
}
