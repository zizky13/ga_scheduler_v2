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
export function assertMaskingInvariant(parent: Gene, child: Gene, locus: number): void;
export function assertMaskingInvariant(parent: Chromosome, child: Chromosome): void;
export function assertMaskingInvariant(
  parent: Gene | Chromosome,
  child: Gene | Chromosome,
  locus?: number
): void {
  // Chromosome-level overload: walk locus-by-locus and delegate.
  if (Array.isArray(parent) && Array.isArray(child)) {
    if (parent.length !== child.length) {
      throw new Error(
        `MASKING VIOLATION: parent length ${parent.length} !== child length ${child.length}`
      );
    }
    for (let i = 0; i < parent.length; i++) {
      const p = parent[i]!;
      const c = child[i]!;
      if (p.offeringId !== c.offeringId) {
        throw new Error(
          `MASKING VIOLATION at locus ${i}: offeringId changed from ${p.offeringId} to ${c.offeringId}`
        );
      }
      assertMaskingInvariant(p, c, i);
    }
    return;
  }

  // Per-locus overload (original body, behavior unchanged).
  const parentGene = parent as Gene;
  const childGene = child as Gene;
  if (process.env.NODE_ENV !== 'production') {
    if (parentGene.kind === 'FIXED') {
      if (childGene.kind !== 'FIXED' || parentGene.roomId !== childGene.roomId) {
        throw new Error(
          `MASKING VIOLATION at locus ${locus}: ` +
          `Fixed gene roomId changed from ${parentGene.roomId} to ${
            childGene.kind === 'FIXED' ? childGene.roomId : 'FLEXIBLE(kind changed)'
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
