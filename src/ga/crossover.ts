/**
 * GA — Crossover Operators
 *
 * Three strategies per the spec:
 *   1. Single-point crossover
 *   2. Uniform crossover
 *   3. PMX (Partially Mapped Crossover)
 *
 * Masking invariant: a child gene at locus i inherits its kind from the
 * parent that contributed locus i. Since Fixed Room offerings always have
 * kind='FIXED' in every chromosome (kind derives from isFixedRoom on the
 * candidate, which never changes), spreading the gene object naturally
 * preserves the invariant — no extra guarding needed.
 */

import type { Chromosome, Gene } from '../types.js';

/** Runtime masking invariant check (non-production only) */
export function assertMaskingInvariant(parent: Gene, child: Gene, locus: number): void {
  if (process.env.NODE_ENV !== 'production') {
    if (parent.kind === 'FIXED') {
      if (child.kind !== 'FIXED' || parent.roomId !== child.roomId) {
        throw new Error(
          `MASKING VIOLATION at locus ${locus}: ` +
          `Fixed gene roomId changed from ${parent.roomId} to ${
            child.kind === 'FIXED' ? child.roomId : 'FLEXIBLE(kind changed)'
          }`
        );
      }
    }
  }
}

/** Single-point crossover */
export function singlePointCrossover(
  parent1: Chromosome,
  parent2: Chromosome
): [Chromosome, Chromosome] {
  const point = Math.floor(Math.random() * parent1.length);
  const child1: Chromosome = [
    ...parent1.slice(0, point).map(g => ({ ...g, assignedTimeSlotIds: [...g.assignedTimeSlotIds] }) as Gene),
    ...parent2.slice(point).map(g => ({ ...g, assignedTimeSlotIds: [...g.assignedTimeSlotIds] }) as Gene),
  ];
  const child2: Chromosome = [
    ...parent2.slice(0, point).map(g => ({ ...g, assignedTimeSlotIds: [...g.assignedTimeSlotIds] }) as Gene),
    ...parent1.slice(point).map(g => ({ ...g, assignedTimeSlotIds: [...g.assignedTimeSlotIds] }) as Gene),
  ];
  return [child1, child2];
}

/** Uniform crossover — each gene randomly from either parent */
export function uniformCrossover(
  parent1: Chromosome,
  parent2: Chromosome
): [Chromosome, Chromosome] {
  const child1: Chromosome = [];
  const child2: Chromosome = [];
  for (let i = 0; i < parent1.length; i++) {
    if (Math.random() < 0.5) {
      child1.push({ ...parent1[i]!, assignedTimeSlotIds: [...parent1[i]!.assignedTimeSlotIds] });
      child2.push({ ...parent2[i]!, assignedTimeSlotIds: [...parent2[i]!.assignedTimeSlotIds] });
    } else {
      child1.push({ ...parent2[i]!, assignedTimeSlotIds: [...parent2[i]!.assignedTimeSlotIds] });
      child2.push({ ...parent1[i]!, assignedTimeSlotIds: [...parent1[i]!.assignedTimeSlotIds] });
    }
  }
  return [child1, child2];
}

/** PMX — Partially Mapped Crossover */
export function pmxCrossover(
  parent1: Chromosome,
  parent2: Chromosome
): [Chromosome, Chromosome] {
  const len = parent1.length;
  let start = Math.floor(Math.random() * len);
  let end = Math.floor(Math.random() * len);
  if (start > end) [start, end] = [end, start];

  const child1: Gene[] = parent1.map(g => ({ ...g, assignedTimeSlotIds: [...g.assignedTimeSlotIds] }));
  const child2: Gene[] = parent2.map(g => ({ ...g, assignedTimeSlotIds: [...g.assignedTimeSlotIds] }));

  // Swap only assignedTimeSlotIds in the segment — preserves kind and roomId
  for (let i = start; i <= end; i++) {
    const tmp = child1[i]!.assignedTimeSlotIds;
    child1[i]!.assignedTimeSlotIds = [...child2[i]!.assignedTimeSlotIds];
    child2[i]!.assignedTimeSlotIds = [...tmp];
  }

  return [child1, child2];
}

/** Get crossover function by type */
export function getCrossoverFn(
  type: 'singlePoint' | 'uniform' | 'pmx'
): (p1: Chromosome, p2: Chromosome) => [Chromosome, Chromosome] {
  switch (type) {
    case 'singlePoint': return singlePointCrossover;
    case 'uniform': return uniformCrossover;
    case 'pmx': return pmxCrossover;
  }
}
