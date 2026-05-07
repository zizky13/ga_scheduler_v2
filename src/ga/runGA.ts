/**
 * GA — Main Evolutionary Loop
 * 
 * runGA() takes PreGACandidate[] and GAConfig, returns GAResult.
 * Completely isolated from Prisma/Express — pure computation.
 * Includes stagnation exit (Section 8.2).
 */

import type { Chromosome, Gene, PreGACandidate, EvaluatedChromosome, GAConfig, GAResult, TimeSlot } from '../types.js';
import { generateInitialPopulation } from './population.js';
import { evaluateFitness, type CompetencyEligibilityMap } from './fitness.js';
import { tournamentSelection } from './selection.js';
import { getCrossoverFn } from './crossover.js';
import { mutateChromosome } from './mutation.js';
import { repairChromosome } from './repair.js';
import { buildSlotLookup } from './chromosome.js';

const STAGNATION_WINDOW = 100; // Updated from 15 — Fixed Room masking can create deeper local optima
const STAGNATION_THRESHOLD = 1e-6;

/**
 * Per-generation snapshot surfaced to the worker via the `onGeneration` hook
 * (Phase 3 task 2). Mirrors the fields the worker persists into
 * `FitnessHistory` and `ScheduleRun` and the SSE handler ships on `progress`
 * events (api_design §5.3.8).
 */
export interface GenerationSnapshot {
  generation: number;
  bestFitness: number;
  avgFitness: number;
  hardViolations: number;
  softPenalty: number;
  competencyMismatch: number;
  structuralPenalty: number;
  preferencePenalty: number;
}

/**
 * Per-checkpoint snapshot of full GA state. Surfaced via `onCheckpoint`
 * every `CHECKPOINT_INTERVAL` generations (Phase 3 task 4, techspec §7.2).
 * The worker layers `runId` and `checkpointedAt` on top to form the
 * `GACheckpointPayload` written to Redis.
 *
 * `bestChromosome` and `population` are deep copies so subsequent
 * generations cannot mutate buffered state before the worker serialises it.
 */
export interface GACheckpointSnapshot {
  generation: number;
  bestChromosome: Chromosome;
  bestFitness: number;
  hardViolations: number;
  population: Chromosome[];
  history: number[];
  avgHistory: number[];
  candidates: PreGACandidate[];
}

/** Generation cadence for checkpoint writes (techspec §7.2). */
export const CHECKPOINT_INTERVAL = 10;

/**
 * Optional GA loop hooks. Bundled into a single struct so future hooks
 * (e.g. progress throttling, mid-run pause) can be added without churning
 * `runGA`'s signature.
 *
 * - `onGeneration`: called once per completed generation BEFORE stagnation /
 *   perfect-solution exits, so the worker observes every generation that ran.
 *   The synchronous loop means async work in this callback is queued — the
 *   worker buffers events and flushes them after `runGA` returns.
 *   See Phase 3 task 10 (event-loop yielding refactor).
 * - `shouldCancel`: queried at the top of every generation. Returning `true`
 *   exits the loop cleanly with the best-so-far chromosome. Phase 3 task 8
 *   wires this to the Redis cancellation flag; the hook itself stays here.
 * - `onCheckpoint`: called every `CHECKPOINT_INTERVAL` generations (techspec
 *   §7.2). Same buffering caveat as `onGeneration` until Phase 3 task 10.
 */
export interface GAHooks {
  onGeneration?: (snapshot: GenerationSnapshot) => void;
  shouldCancel?: () => boolean;
  onCheckpoint?: (snapshot: GACheckpointSnapshot) => void;
}

export function runGA(
  candidates: PreGACandidate[],
  lecturerStructuralMap: Map<number, boolean>,
  lecturerPreferenceMap: Map<number, Set<number>>,
  config: GAConfig,
  competencyEligibilityMap?: CompetencyEligibilityMap,
  allTimeSlots?: TimeSlot[],
  hooks?: GAHooks
): GAResult {
  const crossover = getCrossoverFn(config.crossoverType);

  // Build slot lookup for contiguous-block enforcement (Task 18).
  // When allTimeSlots is provided, genes are guaranteed to use contiguous blocks.
  const slotLookup = allTimeSlots ? buildSlotLookup(allTimeSlots) : undefined;

  // Step 1: Generate initial population + repair each individual (ADR-02)
  let population: Chromosome[] = generateInitialPopulation(
    candidates, config.populationSize, config.noiseRate, slotLookup
  ).map(ch => repairChromosome(ch, candidates, slotLookup));

  const history: number[] = [];
  const avgHistory: number[] = [];

  let overallBest: Chromosome | null = null;
  let overallBestFitness = -Infinity;
  let overallHardViolations = Infinity;
  let overallSoftPenalty = 0;

  // Stagnation tracking
  let stagnationCounter = 0;
  let lastRecordedBestFitness = -Infinity;
  let stagnatedEarly = false;
  let generationsRun = 0;

  // Step 2: Main generation loop
  for (let gen = 0; gen < config.generations; gen++) {
    // Cooperative cancellation hook — Phase 3 task 8 wires the actual flag
    // fetch from Redis. For now the worker passes a no-op that returns false.
    if (hooks?.shouldCancel?.()) {
      break;
    }

    generationsRun = gen + 1;

    // Evaluate all chromosomes using weighted formula (W_H, W_S from GAConfig)
    const fitnessConfig = {
      hardPenaltyWeight: config.hardPenaltyWeight,
      softPenaltyWeight: config.softPenaltyWeight,
    };
    const evaluated: EvaluatedChromosome[] = population.map(ch =>
      evaluateFitness(ch, candidates, lecturerStructuralMap, lecturerPreferenceMap, fitnessConfig, competencyEligibilityMap)
    );

    // Sort by fitness descending
    evaluated.sort((a, b) => b.fitness - a.fitness);

    const best = evaluated[0]!;
    const avgFitness = evaluated.reduce((s, e) => s + e.fitness, 0) / evaluated.length;

    history.push(best.fitness);
    avgHistory.push(avgFitness);

    // Track overall best
    if (best.fitness > overallBestFitness) {
      overallBest = best.chromosome.map(g => ({
        ...g,
        sessions: g.sessions.map(s => ({ roomId: s.roomId, timeSlotIds: [...s.timeSlotIds] })),
      })) as Gene[];
      overallBestFitness = best.fitness;
      overallHardViolations = best.hardViolations;
      overallSoftPenalty = best.softPenalty;
    }

    // Log progress (every 10 gens or first/last)
    if (gen === 0 || gen === config.generations - 1 || (gen + 1) % 10 === 0) {
      console.log(
        `  [Gen ${String(gen + 1).padStart(4)}] ` +
        `Best: ${best.fitness.toFixed(4)} | ` +
        `Avg: ${avgFitness.toFixed(4)} | ` +
        `Hard: ${best.hardViolations} | ` +
        `Soft: ${best.softPenalty} (struct=${best.structuralPenalty} pref=${best.preferencePenalty})`
      );
    }

    if (hooks?.onGeneration) {
      hooks.onGeneration({
        generation: gen + 1,
        bestFitness: best.fitness,
        avgFitness,
        hardViolations: best.hardViolations,
        softPenalty: best.softPenalty,
        competencyMismatch: best.competencyMismatch,
        structuralPenalty: best.structuralPenalty,
        preferencePenalty: best.preferencePenalty,
      });
    }

    // Checkpoint snapshot (techspec §7.2 — Phase 3 task 4). Fires every
    // CHECKPOINT_INTERVAL generations using 1-indexed generation numbers
    // so generation 10/20/30/... and the final generation are observable.
    // Deep-copy population + bestChromosome so the worker's serialisation
    // sees the snapshot at this generation, not state mutated by later loops.
    if (hooks?.onCheckpoint && (gen + 1) % CHECKPOINT_INTERVAL === 0) {
      hooks.onCheckpoint({
        generation: gen + 1,
        bestChromosome: cloneChromosome(overallBest!),
        bestFitness: overallBestFitness,
        hardViolations: overallHardViolations,
        population: population.map(cloneChromosome),
        history: history.slice(),
        avgHistory: avgHistory.slice(),
        candidates,
      });
    }

    // Stagnation detection (Section 8.2)
    if (best.fitness - lastRecordedBestFitness > STAGNATION_THRESHOLD) {
      stagnationCounter = 0;
      lastRecordedBestFitness = best.fitness;
    } else {
      stagnationCounter++;
    }

    if (stagnationCounter >= STAGNATION_WINDOW && best.hardViolations > 0) {
      console.warn(
        `  ⚠️  Stagnation at gen ${gen + 1}. No improvement in ${STAGNATION_WINDOW} gens. ` +
        `Hard violations: ${best.hardViolations}. Terminating.`
      );
      stagnatedEarly = true;
      break;
    }

    // Early exit on perfect solution
    if (best.hardViolations === 0 && best.softPenalty === 0) {
      console.log(`  🎯 Perfect solution found at gen ${gen + 1}!`);
      break;
    }

    // Build next generation
    const newPopulation: Chromosome[] = [];

    // Elitism: preserve top chromosomes
    for (let i = 0; i < config.elitismCount && i < evaluated.length; i++) {
      newPopulation.push(evaluated[i]!.chromosome);
    }

    // Fill remaining via selection → crossover → mutation → repair
    while (newPopulation.length < config.populationSize) {
      const parent1 = tournamentSelection(evaluated, config.tournamentSize);
      const parent2 = tournamentSelection(evaluated, config.tournamentSize);

      let [child1, child2] = crossover(parent1.chromosome, parent2.chromosome);

      child1 = mutateChromosome(child1, candidates, config.mutationRate, slotLookup);
      child2 = mutateChromosome(child2, candidates, config.mutationRate, slotLookup);

      child1 = repairChromosome(child1, candidates, slotLookup);
      child2 = repairChromosome(child2, candidates, slotLookup);

      newPopulation.push(child1, child2);
    }

    population = newPopulation.slice(0, config.populationSize);
  }

  return {
    bestChromosome: overallBest!,
    bestFitness: overallBestFitness,
    hardViolations: overallHardViolations,
    softPenalty: overallSoftPenalty,
    history,
    avgHistory,
    stagnatedEarly,
    generationsRun,
  };
}

function cloneChromosome(chromosome: Chromosome): Chromosome {
  return chromosome.map((g) => ({
    ...g,
    sessions: g.sessions.map((s) => ({
      roomId: s.roomId,
      timeSlotIds: [...s.timeSlotIds],
    })),
  })) as Chromosome;
}
