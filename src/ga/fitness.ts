/**
 * GA — Fitness Evaluation (ADR-03: Weighted Formula)
 *
 * Weighted fitness (PRD v6.0):
 *   fitness = 1 / (1 + hardViolations×W_H + softPenalty×W_S)
 *
 * With W_H=100, W_S=1 (defaults), any chromosome with hardViolations > 0
 * will always score below any chromosome with hardViolations = 0.
 *
 * Hard constraints: room-time collisions, lecturer-time collisions
 * Soft constraints:
 *   - Structural lecturer overload (> 2 sessions/week)
 *   - Lecturer preference violations (assigned slots ∉ preferred slots)
 *
 * Gene shape: sessions[]{roomId, timeSlotIds} (Task 16).
 * Hard-fitness counts collisions per (roomId, slotId) and (lecturerId, slotId)
 * across every session of every gene, so it captures both cross-gene clashes
 * and intra-gene parallel-session clashes (Task 20).
 */

import type { Chromosome, EvaluatedChromosome, PreGACandidate } from '../types.js';

export interface FitnessConfig {
  hardPenaltyWeight: number;   // W_H — default 100
  softPenaltyWeight: number;   // W_S — default 1
}

/**
 * Eligibility map: offeringId → Set of lecturerIds that are competency-eligible
 * for that offering's course. Built once per pipeline run from Lecturer/Course data
 * (see isLecturerEligibleForCourse). Empty Set means "no eligible lecturer";
 * any non-eligible lecturer assigned in a gene counts as a hard violation.
 */
export type CompetencyEligibilityMap = Map<number, Set<number>>;

/**
 * Evaluate hard constraint violations.
 * Iterates over gene.sessions — each session owns its roomId and timeSlotIds.
 */
export function evaluateHardFitness(
  chromosome: Chromosome,
  candidates: PreGACandidate[]
): number {
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));
  let violations = 0;

  const roomTimeMap = new Map<string, number>();
  const lecturerTimeMap = new Map<string, number>();

  for (const gene of chromosome) {
    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) continue;

    for (const session of gene.sessions) {
      for (const slotId of session.timeSlotIds) {
        const roomKey = `room:${session.roomId}:slot:${slotId}`;
        const roomCount = (roomTimeMap.get(roomKey) ?? 0) + 1;
        roomTimeMap.set(roomKey, roomCount);
        if (roomCount > 1) violations++;

        for (const lecturerId of candidate.lecturerIds) {
          const lecKey = `lec:${lecturerId}:slot:${slotId}`;
          const lecCount = (lecturerTimeMap.get(lecKey) ?? 0) + 1;
          lecturerTimeMap.set(lecKey, lecCount);
          if (lecCount > 1) violations++;
        }
      }
    }
  }

  return violations;
}

/**
 * Competency mismatch — hard violation count.
 * For each gene, every assigned lecturer not in the eligibility set contributes
 * one violation per scheduled slot across all sessions.
 * If no eligibility map is supplied, treat all assignments as eligible (no-op).
 */
export function evaluateCompetencyMismatch(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
  eligibilityMap?: CompetencyEligibilityMap
): number {
  if (!eligibilityMap) return 0;
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));
  let violations = 0;

  for (const gene of chromosome) {
    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) continue;
    const eligible = eligibilityMap.get(gene.offeringId);
    if (!eligible) continue; // no entry = open assignment

    const totalSlots = gene.sessions.reduce((sum, s) => sum + s.timeSlotIds.length, 0);

    for (const lecturerId of candidate.lecturerIds) {
      if (!eligible.has(lecturerId)) {
        violations += totalSlots;
      }
    }
  }

  return violations;
}

/** Structural lecturer penalty — > 2 sessions/week incurs a penalty. */
export function calculateStructuralPenalty(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
  lecturerStructuralMap: Map<number, boolean>
): number {
  const lecturerSessionCount = new Map<number, number>();
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));

  for (const gene of chromosome) {
    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) continue;

    const totalSlots = gene.sessions.reduce((sum, s) => sum + s.timeSlotIds.length, 0);

    for (const lecturerId of candidate.lecturerIds) {
      if (lecturerStructuralMap.get(lecturerId)) {
        const count = (lecturerSessionCount.get(lecturerId) ?? 0) + totalSlots;
        lecturerSessionCount.set(lecturerId, count);
      }
    }
  }

  let penalty = 0;
  const STRUCTURAL_MAX_SESSIONS = 2;

  for (const [, count] of lecturerSessionCount) {
    if (count > STRUCTURAL_MAX_SESSIONS) {
      penalty += count - STRUCTURAL_MAX_SESSIONS;
    }
  }

  return penalty;
}

/** Lecturer preference penalty — each non-preferred slot incurs +1. */
export function calculatePreferencePenalty(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
  lecturerPreferenceMap: Map<number, Set<number>>
): number {
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));
  let penalty = 0;

  for (const gene of chromosome) {
    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) continue;

    for (const lecturerId of candidate.lecturerIds) {
      const preferred = lecturerPreferenceMap.get(lecturerId);
      if (!preferred || preferred.size === 0) continue;

      for (const session of gene.sessions) {
        for (const slotId of session.timeSlotIds) {
          if (!preferred.has(slotId)) {
            penalty++;
          }
        }
      }
    }
  }

  return penalty;
}

/** Full fitness evaluation with weighted formula. */
export function evaluateFitness(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
  lecturerStructuralMap: Map<number, boolean>,
  lecturerPreferenceMap: Map<number, Set<number>>,
  config: FitnessConfig = { hardPenaltyWeight: 100, softPenaltyWeight: 1 },
  competencyEligibilityMap?: CompetencyEligibilityMap
): EvaluatedChromosome {
  const collisionViolations = evaluateHardFitness(chromosome, candidates);
  const competencyMismatch = evaluateCompetencyMismatch(chromosome, candidates, competencyEligibilityMap);
  const hardViolations = collisionViolations + competencyMismatch;
  const structuralPenalty = calculateStructuralPenalty(chromosome, candidates, lecturerStructuralMap);
  const preferencePenalty = calculatePreferencePenalty(chromosome, candidates, lecturerPreferenceMap);
  const softPenalty = structuralPenalty + preferencePenalty;

  const fitness = 1 / (
    1 +
    (hardViolations * config.hardPenaltyWeight) +
    (softPenalty * config.softPenaltyWeight)
  );

  return { chromosome, fitness, hardViolations, softPenalty, structuralPenalty, preferencePenalty, loadPenalty: 0, competencyMismatch };
}
