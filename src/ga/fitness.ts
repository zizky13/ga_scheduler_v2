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
 * Gene shape: sessions[]{roomId, timeSlotIds, lecturerIds} (Phase 15 #5).
 * Hard-fitness counts collisions per (roomId, slotId) and (lecturerId, slotId)
 * across every session of every gene, so it captures both cross-gene clashes
 * and intra-gene parallel-session clashes (Task 20).
 *
 * Phase 15 #8: the lecturer dimension is read per session (`session.lecturer
 * Ids`) instead of per candidate (`candidate.lecturerIds`). For multi-sibling
 * cohorts this is the load-bearing change — sibling sessions now hold their
 * own lecturer subset of the cohort's pool, and a sibling pair at the same
 * timeslot sharing a lecturer naturally surfaces as one hard violation.
 * Single-sibling cohorts behave identically to the pre-Phase-15 path: the
 * chromosome seeder stamps `candidate.lecturerIds` on every session, so
 * per-session reading and per-candidate reading converge.
 */

import type { Chromosome, EvaluatedChromosome, PreGACandidate, Room, TimeSlot } from '../types.js';

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

const MAX_DAY_GAP = 100;

/**
 * Evaluate hard constraint violations.
 * Iterates over gene.sessions — each session owns its roomId, timeSlotIds,
 * and (Phase 15 #5) per-session lecturerIds. The candidate is no longer
 * consulted for lecturer collisions; the GA evolves per-session lecturer
 * assignment and fitness must reflect that distribution.
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

        for (const lecturerId of session.lecturerIds) {
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
 *
 * Phase 15 #8: reads per-session `session.lecturerIds`. For each session, a
 * non-eligible lecturer contributes one violation per slot of that session
 * (NOT the gene's total slot count — sibling sessions may carry different
 * lecturers under the multi-sibling cohort model, so the per-session
 * accounting is the only way to charge violations to the right sessions).
 *
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

    for (const session of gene.sessions) {
      for (const lecturerId of session.lecturerIds) {
        if (!eligible.has(lecturerId)) {
          violations += session.timeSlotIds.length;
        }
      }
    }
  }

  return violations;
}

/**
 * Structural lecturer penalty — > 2 sessions/week incurs a penalty.
 *
 * Phase 15 #8: counts per-session lecturer slots instead of charging every
 * candidate.lecturer with the gene's total slot count. A multi-sibling
 * cohort where Mr. X teaches sessions[0,2] and Mr. Y teaches sessions[1,3]
 * now charges each lecturer only for the sessions they actually own.
 */
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

    for (const session of gene.sessions) {
      const slotsInSession = session.timeSlotIds.length;
      for (const lecturerId of session.lecturerIds) {
        if (lecturerStructuralMap.get(lecturerId)) {
          const count = (lecturerSessionCount.get(lecturerId) ?? 0) + slotsInSession;
          lecturerSessionCount.set(lecturerId, count);
        }
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
 *
 * Phase 15 #8: credits each `session.lecturerIds` lecturer with the
 * session's slot count (= `candidate.sessionDuration` since the seeder /
 * mutation invariant guarantees `session.timeSlotIds.length === sessionDur
 * ation`). Multi-sibling cohorts naturally produce balanced load — each
 * lecturer absorbs only the sessions they own, not the cohort's full
 * teaching load. Single-sibling team-teach offerings (every session has
 * the same lecturer set) credit each lecturer per parallel session, which
 * accurately reflects the physical teaching commitment.
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
    for (const session of gene.sessions) {
      const sks = session.timeSlotIds.length;
      for (const lecturerId of session.lecturerIds) {
        assignedSks.set(lecturerId, (assignedSks.get(lecturerId) ?? 0) + sks);
      }
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

/**
 * Fragmentation penalty (Phase 16 task #6).
 *
 * A session is ideal when every adjacent slot pair is same-day and strictly
 * back-to-back (`current.endTime === next.startTime`, OQ-32). Same-day gaps
 * are charged by the number of missing slot positions between the two slots.
 * Cross-day pairs are charged a large defense-in-depth constant; OQ-33 keeps
 * production seeding / mutation same-day, but stale or hand-built chromosomes
 * can still surface here.
 *
 * When `timeSlotById` is omitted, returns 0 for legacy unit callers that do
 * not have timetable topology available.
 */
export function calculateFragmentationPenalty(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
  timeSlotById?: ReadonlyMap<number, TimeSlot>,
): number {
  if (!timeSlotById) return 0;
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));

  const slotIndexByDay = new Map<string, Map<number, number>>();
  const slotsByDay = new Map<string, TimeSlot[]>();
  for (const slot of timeSlotById.values()) {
    const slots = slotsByDay.get(slot.day) ?? [];
    slots.push(slot);
    slotsByDay.set(slot.day, slots);
  }
  for (const [day, slots] of slotsByDay) {
    slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
    slotIndexByDay.set(day, new Map(slots.map((slot, index) => [slot.id, index])));
  }

  let penalty = 0;
  for (const gene of chromosome) {
    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) continue;

    for (const session of gene.sessions) {
      for (let i = 0; i < session.timeSlotIds.length - 1; i++) {
        const current = timeSlotById.get(session.timeSlotIds[i]!);
        const next = timeSlotById.get(session.timeSlotIds[i + 1]!);
        if (!current || !next) continue;

        if (current.day !== next.day) {
          penalty += MAX_DAY_GAP;
          continue;
        }

        if (current.endTime === next.startTime) continue;

        const dayIndex = slotIndexByDay.get(current.day);
        const currentIndex = dayIndex?.get(current.id);
        const nextIndex = dayIndex?.get(next.id);
        if (currentIndex === undefined || nextIndex === undefined) {
          penalty += 1;
          continue;
        }

        penalty += Math.max(1, Math.abs(nextIndex - currentIndex) - 1);
      }
    }
  }

  return penalty;
}

/**
 * Phase 15 #10 — distribution audit telemetry for multi-offering cohorts.
 *
 * Shannon entropy over the per-lecturer session-assignment counts across
 * candidates with `siblingOfferingIds.length > 1`. This is intentionally
 * observational: it is NOT part of `softPenalty`, so it cannot change GA
 * selection pressure. Higher values mean the multi-sibling cohort sessions
 * are spread more evenly across the available lecturer pool; 0 means either
 * no multi-sibling cohorts exist or all counted sessions landed on one
 * lecturer. Team-teach sessions count once per assigned lecturer.
 */
export function calculateLecturerDistributionEntropy(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
): number {
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));
  const sessionCounts = new Map<number, number>();
  let totalAssignments = 0;

  for (const gene of chromosome) {
    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) continue;
    if ((candidate.siblingOfferingIds?.length ?? 1) <= 1) continue;

    for (const session of gene.sessions) {
      for (const lecturerId of session.lecturerIds) {
        sessionCounts.set(lecturerId, (sessionCounts.get(lecturerId) ?? 0) + 1);
        totalAssignments++;
      }
    }
  }

  if (totalAssignments === 0) return 0;

  let entropy = 0;
  for (const count of sessionCounts.values()) {
    const p = count / totalAssignments;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Lecturer preference penalty — each non-preferred slot incurs +1.
 *
 * Phase 15 #8: walks per-session `session.lecturerIds`. A lecturer assigned
 * to one session of a multi-sibling cohort is charged only for their
 * session's slots, not every parallel session's slots. Charges each lecturer
 * separately when team-teaching within a session (OQ-25 preserved).
 */
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

    for (const session of gene.sessions) {
      for (const lecturerId of session.lecturerIds) {
        const preferred = lecturerPreferenceMap.get(lecturerId);
        if (!preferred || preferred.size === 0) continue;

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
  timeSlotById?: ReadonlyMap<number, TimeSlot>,
): EvaluatedChromosome {
  const collisionViolations = evaluateHardFitness(chromosome, candidates);
  const competencyMismatch = evaluateCompetencyMismatch(chromosome, candidates, competencyEligibilityMap);
  const hardViolations = collisionViolations + competencyMismatch;
  const structuralPenalty = calculateStructuralPenalty(chromosome, candidates, lecturerStructuralMap);
  const preferencePenalty = calculatePreferencePenalty(chromosome, candidates, lecturerPreferenceMap);
  const loadPenalty = calculateLoadPenalty(chromosome, candidates, lecturerMaxSksMap);
  const capacityShortfallPenalty = calculateCapacityShortfallPenalty(chromosome, candidates, roomById);
  const fragmentationPenalty = calculateFragmentationPenalty(chromosome, candidates, timeSlotById);
  const lecturerDistributionEntropy = calculateLecturerDistributionEntropy(chromosome, candidates);
  const softPenalty =
    structuralPenalty +
    preferencePenalty +
    loadPenalty +
    capacityShortfallPenalty +
    fragmentationPenalty;

  const fitness = 1 / (
    1 +
    (hardViolations * config.hardPenaltyWeight) +
    (softPenalty * config.softPenaltyWeight)
  );

  return {
    chromosome,
    fitness,
    hardViolations,
    softPenalty,
    structuralPenalty,
    preferencePenalty,
    loadPenalty,
    capacityShortfallPenalty,
    fragmentationPenalty,
    lecturerDistributionEntropy,
    competencyMismatch,
  };
}
