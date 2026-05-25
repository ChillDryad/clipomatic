import { create } from 'zustand'
import {
  enqueuePipelineJob,
  getPipelineJobs,
  getPipelineJob,
  cancelPipelineJob,
  retryPipelineJob,
  pausePipelineJob,
  resumePipelineJob,
  getPipelineQueueStatus,
  type PipelineJobApi,
  type PipelineEventApi,
} from '../api'

interface JobProgress {
  step: string | null
  progress: number
  label: string | null
}

interface PipelineQueueState {
  jobs: PipelineJobApi[]
  totalJobs: number
  queueStatus: { queued: number; running: number } | null
  activeJobId: string | null
  jobProgress: Map<string, JobProgress>
  autoPipelineEnabled: boolean

  // Actions
  enqueue: (projectId: string, steps?: string[], config?: Record<string, unknown>) => Promise<string>
  fetchJobs: (status?: string) => Promise<void>
  fetchJob: (jobId: string) => Promise<void>
  cancelJob: (jobId: string) => Promise<void>
  retryJob: (jobId: string, config?: Record<string, unknown>) => Promise<void>
  pauseJob: (jobId: string) => Promise<void>
  resumeJob: (jobId: string) => Promise<void>
  fetchQueueStatus: () => Promise<void>
  setActiveJobId: (id: string | null) => void
  setAutoPipelineEnabled: (v: boolean) => void
  updateJobProgress: (jobId: string, progress: JobProgress) => void
}

export const usePipelineQueueStore = create<PipelineQueueState>((set, get) => ({
  jobs: [],
  totalJobs: 0,
  queueStatus: null,
  activeJobId: null,
  jobProgress: new Map(),
  autoPipelineEnabled: localStorage.getItem('autoPipelineEnabled') === 'true',

  enqueue: async (projectId, steps, config) => {
    const result = await enqueuePipelineJob({ project_id: projectId, steps, config })
    set({ activeJobId: result.job_id })
    // Refresh job list
    get().fetchJobs()
    return result.job_id
  },

  fetchJobs: async (status) => {
    const result = await getPipelineJobs({ status, limit: 50 })
    set({ jobs: result.jobs, totalJobs: result.total })
  },

  fetchJob: async (jobId) => {
    const job = await getPipelineJob(jobId)
    set(state => ({
      jobs: state.jobs.map(j => (j.id === jobId ? job : j)),
      jobProgress: new Map(state.jobProgress).set(jobId, {
        step: job.step_label ? job.steps[job.current_step] : null,
        progress: job.step_progress,
        label: job.step_label,
      }),
    }))
  },

  cancelJob: async (jobId) => {
    await cancelPipelineJob(jobId)
    set(state => ({
      jobs: state.jobs.map(j => (j.id === jobId ? { ...j, status: 'cancelled' as const } : j)),
      activeJobId: state.activeJobId === jobId ? null : state.activeJobId,
    }))
  },

  retryJob: async (jobId, config) => {
    const result = await retryPipelineJob(jobId, config)
    set(state => ({
      jobs: state.jobs.map(j => (j.id === jobId ? { ...j, status: 'queued' as const } : j)),
    }))
  },

  pauseJob: async (jobId) => {
    await pausePipelineJob(jobId)
  },

  resumeJob: async (jobId) => {
    await resumePipelineJob(jobId)
  },

  fetchQueueStatus: async () => {
    const status = await getPipelineQueueStatus()
    set({ queueStatus: { queued: status.queued, running: status.running } })
  },

  setActiveJobId: (id) => set({ activeJobId: id }),

  setAutoPipelineEnabled: (v) => {
    localStorage.setItem('autoPipelineEnabled', String(v))
    set({ autoPipelineEnabled: v })
  },

  updateJobProgress: (jobId, progress) => {
    set(state => ({
      jobProgress: new Map(state.jobProgress).set(jobId, progress),
    }))
  },
}))