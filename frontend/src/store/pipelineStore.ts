import { create } from 'zustand'
import type { SchedulerResponse } from '@pipeline/types'

export type PipelineStatus = 'idle' | 'running' | 'success' | 'failed' | 'infeasible'

interface PipelineState {
  status: PipelineStatus
  response: SchedulerResponse | null
  error: string | null
  setRunning: () => void
  setResult: (response: SchedulerResponse) => void
  setError: (error: string) => void
  reset: () => void
}

export const usePipelineStore = create<PipelineState>((set) => ({
  status: 'idle',
  response: null,
  error: null,
  setRunning: () => set({ status: 'running', response: null, error: null }),
  setResult: (response) => set({
    status: response.status === 'SUCCESS'
      ? 'success'
      : response.status === 'INFEASIBLE'
        ? 'infeasible'
        : 'failed',
    response,
    error: null,
  }),
  setError: (error) => set({ status: 'failed', response: null, error }),
  reset: () => set({ status: 'idle', response: null, error: null }),
}))
