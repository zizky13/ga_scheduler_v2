/**
 * GA — Population Generation
 *
 * When a SlotLookup is provided, genes are created with contiguous-slot
 * enforcement (Task 18). Otherwise falls back to legacy shuffle-and-slice.
 */

import type { Chromosome, PreGACandidate } from '../types.js';
import { createRandomChromosome, type SlotLookup } from './chromosome.js';

export function generateInitialPopulation(
  candidates: PreGACandidate[],
  populationSize: number,
  noiseRate: number = 0.15,
  lookup?: SlotLookup
): Chromosome[] {
  const population: Chromosome[] = [];
  for (let i = 0; i < populationSize; i++) {
    population.push(createRandomChromosome(candidates, noiseRate, lookup));
  }
  return population;
}
