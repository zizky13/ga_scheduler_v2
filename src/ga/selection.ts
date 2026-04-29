/**
 * GA — Tournament Selection
 */

import type { EvaluatedChromosome } from '../types.js';

export function tournamentSelection(
  evaluated: EvaluatedChromosome[],
  tournamentSize: number
): EvaluatedChromosome {
  let best: EvaluatedChromosome | null = null;

  for (let i = 0; i < tournamentSize; i++) {
    const idx = Math.floor(Math.random() * evaluated.length);
    const competitor = evaluated[idx]!;
    if (!best || competitor.fitness > best.fitness) {
      best = competitor;
    }
  }

  return best!;
}
