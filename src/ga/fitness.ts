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

import type { Chromosome, EvaluatedChromosome, PreGACandidate, Room } from '../types.js';

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

/**
 * Lecturer load penalty — Σ max(0, assignedSks − maxSks) per lecturer.
 * Team-taught offering: each assigned lecturer is credited the full
 * `candidate.sessionDuration` (= course.sks) — matches the frontend's
 * `currentSksByLecturerId` derivation (Phase 8 task #10).
 */
export function calculateLoadPenalty(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
  lecturerMaxSksMap: Map<number, number>
): number {
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));
  const assignedSks = new Map<number, number>();

  for (const gene of chromosome) {
    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) continue;
    const sks = candidate.sessionDuration;
    for (const lecturerId of candidate.lecturerIds) {
      assignedSks.set(lecturerId, (assignedSks.get(lecturerId) ?? 0) + sks);
    }
  }

  let penalty = 0;
  for (const [lecturerId, total] of assignedSks) {
    const cap = lecturerMaxSksMap.get(lecturerId);
    if (cap === undefined) continue;
    if (total > cap) penalty += total - cap;
  }
  return penalty;
}

/**
 * Capacity-shortfall penalty (Phase 11 task #6).
 *
 * For null-room offerings (where the GA picks per-session rooms from
 * `possibleRoomIds`), the seeder / mutation may land on a combination whose
 * total seat capacity is below the cohort size. This soft penalty pulls the
 * population toward chromosomes whose combined per-session room capacity
 * meets or exceeds `candidate.effectiveStudentCount`. Pre-assigned-room
 * offerings (`candidate.roomId !== null`) are excluded: their split is
 * across timeslots within the chosen room (OQ-16), so the capacity gate is
 * already met by validator construction.
 *
 * Shares `softPenaltyWeight` per OQ-11's precedent — no new GAConfig knob.
 *
 * When `roomById` is omitted (legacy callers / unit tests), returns 0.
 */
export function calculateCapacityShortfallPenalty(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
  roomById?: ReadonlyMap<number, Room>,
): number {
  if (!roomById) return 0;
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));
  let penalty = 0;

  for (const gene of chromosome) {
    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) continue;
    if (candidate.roomId !== null) continue; // OQ-16: pre-assigned rooms exempt

    let combinedCapacity = 0;
    for (const session of gene.sessions) {
      const room = roomById.get(session.roomId);
      if (room) combinedCapacity += room.capacity;
    }

    const shortfall = candidate.effectiveStudentCount - combinedCapacity;
    if (shortfall > 0) penalty += shortfall;
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
  lecturerMaxSksMap: Map<number, number>,
  config: FitnessConfig = { hardPenaltyWeight: 100, softPenaltyWeight: 1 },
  competencyEligibilityMap?: CompetencyEligibilityMap,
  roomById?: ReadonlyMap<number, Room>,
): EvaluatedChromosome {
  const collisionViolations = evaluateHardFitness(chromosome, candidates);
  const competencyMismatch = evaluateCompetencyMismatch(chromosome, candidates, competencyEligibilityMap);
  const hardViolations = collisionViolations + competencyMismatch;
  const structuralPenalty = calculateStructuralPenalty(chromosome, candidates, lecturerStructuralMap);
  const preferencePenalty = calculatePreferencePenalty(chromosome, candidates, lecturerPreferenceMap);
  const loadPenalty = calculateLoadPenalty(chromosome, candidates, lecturerMaxSksMap);
  const capacityShortfallPenalty = calculateCapacityShortfallPenalty(chromosome, candidates, roomById);
  const softPenalty = structuralPenalty + preferencePenalty + loadPenalty + capacityShortfallPenalty;

  const fitness = 1 / (
    1 +
    (hardViolations * config.hardPenaltyWeight) +
    (softPenalty * config.softPenaltyWeight)
  );

  return { chromosome, fitness, hardViolations, softPenalty, structuralPenalty, preferencePenalty, loadPenalty, competencyMismatch };
}
