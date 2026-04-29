/**
 * GA — Population Generation
 */

import type { Chromosome, PreGACandidate } from '../types.js';
import { createRandomChromosome } from './chromosome.js';

export function generateInitialPopulation(
  candidates: PreGACandidate[],
  populationSize: number,
  noiseRate: number = 0.15
): Chromosome[] {
  const population: Chromosome[] = [];
  for (let i = 0; i < populationSize; i++) {
    population.push(createRandomChromosome(candidates, noiseRate));
  }
  return population;
}
