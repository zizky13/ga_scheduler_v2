import { runPipeline, type OrchestratorInput } from '@pipeline/orchestrator'
import { rooms, timeSlots, lecturers, courseOfferings } from '@pipeline/db/seed'
import type { GAConfig } from '@pipeline/types'

export { runPipeline }
export type { OrchestratorInput }
export type { GAConfig }

const DEFAULT_CONFIG: GAConfig = {
  populationSize: 50,
  generations: 200,
  mutationRate: 0.05,
  elitismCount: 2,
  tournamentSize: 5,
  crossoverType: 'uniform',
  noiseRate: 0.1,
  hardPenaltyWeight: 100,
  softPenaltyWeight: 1,
}

export function getDefaultConfig(): GAConfig {
  return { ...DEFAULT_CONFIG }
}

export function getDefaultInput(configOverride?: Partial<GAConfig>): OrchestratorInput {
  return {
    offerings: courseOfferings,
    timeSlots,
    rooms,
    lecturers,
    config: configOverride ? { ...DEFAULT_CONFIG, ...configOverride } : DEFAULT_CONFIG,
  }
}

export { rooms, timeSlots, lecturers, courseOfferings }
