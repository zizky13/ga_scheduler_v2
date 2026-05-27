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
 *
 * sessions[] deep-clone helper: we deep-clone sessions to avoid aliasing
 * mutations across parents and children.
 */

import type { Chromosome, Gene, GeneSession, PreGACandidate } from '../types.js';

/** Deep-clone a sessions array to avoid cross-gene aliasing. */
function cloneSessions(sessions: GeneSession[]): GeneSession[] {
  return sessions.map(s => ({
    roomId: s.roomId,
    timeSlotIds: [...s.timeSlotIds],
    lecturerIds: [...s.lecturerIds],
  }));
}

/** Deep-clone a gene (copies sessions[] so mutations don't alias). */
function cloneGene(g: Gene): Gene {
  return { ...g, sessions: cloneSessions(g.sessions) };
}

type CandidateMask = PreGACandidate[] | Map<number, PreGACandidate>;

function toCandidateMap(candidates?: CandidateMask): Map<number, PreGACandidate> | undefined {
  if (candidates === undefined) return undefined;
  if (candidates instanceof Map) return candidates;
  return new Map(candidates.map(c => [c.offeringId, c]));
}

function assertLecturersWithinPool(
  childGene: Gene,
  candidate: PreGACandidate | undefined,
  locus: number | undefined,
): void {
  if (candidate === undefined) return;

  const lecturerPool = new Set(candidate.lecturerPool);
  for (let sessionIndex = 0; sessionIndex < childGene.sessions.length; sessionIndex++) {
    const session = childGene.sessions[sessionIndex]!;
    for (const lecturerId of session.lecturerIds) {
      if (!lecturerPool.has(lecturerId)) {
        throw new Error(
          `MASKING VIOLATION at locus ${locus} session ${sessionIndex}: ` +
          `lecturerId ${lecturerId} is outside candidate ${candidate.offeringId} lecturerPool ` +
          `[${candidate.lecturerPool.join(', ')}]`
        );
      }
    }
  }
}

/** Runtime masking invariant check (non-production only) */
export function assertMaskingInvariant(
  parent: Gene,
  child: Gene,
  locus: number,
  candidate?: PreGACandidate
): void;
export function assertMaskingInvariant(
  parent: Chromosome,
  child: Chromosome,
  candidates?: CandidateMask
): void;
export function assertMaskingInvariant(
  parent: Gene | Chromosome,
  child: Gene | Chromosome,
  locusOrCandidates?: number | CandidateMask,
  candidate?: PreGACandidate
): void {
  // Chromosome-level overload: walk locus-by-locus and delegate.
  if (Array.isArray(parent) && Array.isArray(child)) {
    const candidateMap = toCandidateMap(
      typeof locusOrCandidates === 'number' ? undefined : locusOrCandidates
    );
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
      const candidateForGene = candidateMap?.get(c.offeringId);
      if (candidateMap !== undefined && candidateForGene === undefined) {
        throw new Error(
          `MASKING VIOLATION at locus ${i}: missing candidate mask for offeringId ${c.offeringId}`
        );
      }
      assertMaskingInvariant(p, c, i, candidateForGene);
    }
    return;
  }

  // Per-locus overload (original body, behavior unchanged).
  const parentGene = parent as Gene;
  const childGene = child as Gene;
  const locus = typeof locusOrCandidates === 'number' ? locusOrCandidates : undefined;
  if (process.env.NODE_ENV !== 'production') {
    if (parentGene.kind === 'FIXED') {
      if (childGene.kind !== 'FIXED') {
        throw new Error(
          `MASKING VIOLATION at locus ${locus}: ` +
          `Fixed gene kind changed to FLEXIBLE`
        );
      }
      // Verify each session's roomId is unchanged.
      for (let i = 0; i < parentGene.sessions.length; i++) {
        const pRoom = parentGene.sessions[i]!.roomId;
        const cRoom = childGene.sessions[i]?.roomId;
        if (pRoom !== cRoom) {
          throw new Error(
            `MASKING VIOLATION at locus ${locus} session ${i}: ` +
            `Fixed gene roomId changed from ${pRoom} to ${cRoom}`
          );
        }
      }
    }

    // Phase 15 #7: crossover may swap whole sessions, but every per-session
    // lecturer assignment must remain masked to the candidate's cohort pool.
    assertLecturersWithinPool(childGene, candidate, locus);
  }
}

/** Single-point crossover */
export function singlePointCrossover(
  parent1: Chromosome,
  parent2: Chromosome
): [Chromosome, Chromosome] {
  const point = Math.floor(Math.random() * parent1.length);
  const child1: Chromosome = [
    ...parent1.slice(0, point).map(cloneGene),
    ...parent2.slice(point).map(cloneGene),
  ];
  const child2: Chromosome = [
    ...parent2.slice(0, point).map(cloneGene),
    ...parent1.slice(point).map(cloneGene),
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
      child1.push(cloneGene(parent1[i]!));
      child2.push(cloneGene(parent2[i]!));
    } else {
      child1.push(cloneGene(parent2[i]!));
      child2.push(cloneGene(parent1[i]!));
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

  const child1: Gene[] = parent1.map(cloneGene);
  const child2: Gene[] = parent2.map(cloneGene);

  // Swap only sessions[] in the segment — preserves kind (masking invariant)
  // by cloning the sessions array from the opposite parent.
  for (let i = start; i <= end; i++) {
    const tmpSessions = child1[i]!.sessions;
    child1[i]!.sessions = cloneSessions(child2[i]!.sessions);
    child2[i]!.sessions = cloneSessions(tmpSessions);
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
