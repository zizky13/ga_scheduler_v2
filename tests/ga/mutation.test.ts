/**
 * Phase 15 #6 — per-session lecturer mutation regression tests.
 *
 * `mutateChromosome` composes three dimensions when the per-gene mutation
 * rate fires: room (FLEXIBLE only), timeslot block, and — when the parent
 * candidate is a multi-sibling cohort — one session's lecturer assignment.
 * These tests pin the lecturer-mutation behaviour: gating on
 * `siblingOfferingIds.length > 1`, pool-bounded re-pick, cardinality
 * preservation for team-teach sessions, and no-op for legacy single-offering
 * candidates so pre-Phase-15 fixtures keep their lecturer assignments
 * across generations.
 */

import { describe, it, expect } from 'vitest';
import { mutateChromosome } from '../../src/ga/mutation.js';
import { buildSlotLookup } from '../../src/ga/chromosome.js';
import type { Chromosome, FlexibleGene, PreGACandidate, TimeSlot } from '../../src/types.js';

const TIME_SLOTS: TimeSlot[] = [
  { id: 1, day: 'Mon', startTime: '08:00', endTime: '08:50' },
  { id: 2, day: 'Mon', startTime: '09:00', endTime: '09:50' },
  { id: 3, day: 'Mon', startTime: '10:00', endTime: '10:50' },
  { id: 4, day: 'Mon', startTime: '11:00', endTime: '11:50' },
  { id: 5, day: 'Tue', startTime: '08:00', endTime: '08:50' },
  { id: 6, day: 'Tue', startTime: '09:00', endTime: '09:50' },
];

const SLOT_LOOKUP = buildSlotLookup(TIME_SLOTS);

function singleSiblingCandidate(): PreGACandidate {
  return {
    offeringId: 100,
    courseId: 1,
    roomId: 10,
    lecturerIds: [1, 2],
    effectiveStudentCount: 30,
    parallelSessionCount: 2,
    sessionDuration: 1,
    possibleTimeSlotIds: [1, 2, 3, 4, 5, 6],
    possibleRoomIds: [10, 11, 12],
    isFixedRoom: false,
    siblingOfferingIds: [100],
    lecturerPool: [1, 2],
    siblingLecturerGroups: [[1, 2]],
  };
}

function multiSiblingSingleLecturerCandidate(): PreGACandidate {
  // User's example: two siblings, one lecturer each, four parallel sessions.
  return {
    offeringId: 200,
    courseId: 2,
    roomId: null,
    lecturerIds: [10],
    effectiveStudentCount: 97,
    parallelSessionCount: 4,
    sessionDuration: 1,
    possibleTimeSlotIds: [1, 2, 3, 4, 5, 6],
    possibleRoomIds: [10, 11, 12, 13],
    isFixedRoom: false,
    siblingOfferingIds: [200, 201],
    lecturerPool: [10, 20],
    siblingLecturerGroups: [[10], [20]],
  };
}

function multiSiblingTeamTeachCandidate(): PreGACandidate {
  // siblings = [{team-teach [1,2]}, {[3]}]. 4 sessions to exercise both
  // single-lecturer and team-teach session-level shapes.
  return {
    offeringId: 300,
    courseId: 3,
    roomId: null,
    lecturerIds: [1, 2],
    effectiveStudentCount: 97,
    parallelSessionCount: 4,
    sessionDuration: 1,
    possibleTimeSlotIds: [1, 2, 3, 4, 5, 6],
    possibleRoomIds: [10, 11, 12, 13],
    isFixedRoom: false,
    siblingOfferingIds: [300, 301],
    lecturerPool: [1, 2, 3],
    siblingLecturerGroups: [[1, 2], [3]],
  };
}

function buildFlexible(candidate: PreGACandidate): FlexibleGene {
  return {
    kind: 'FLEXIBLE',
    offeringId: candidate.offeringId,
    sessions: candidate.siblingLecturerGroups.length === 1
      ? Array.from({ length: candidate.parallelSessionCount }, () => ({
          roomId: candidate.possibleRoomIds![0]!,
          timeSlotIds: [1],
          lecturerIds: [...candidate.lecturerIds],
        }))
      : Array.from({ length: candidate.parallelSessionCount }, (_, i) => ({
          roomId: candidate.possibleRoomIds![0]!,
          timeSlotIds: [1],
          lecturerIds: [...candidate.siblingLecturerGroups[i % candidate.siblingLecturerGroups.length]!],
        })),
  };
}

describe('mutateChromosome — Phase 15 #6 lecturer dimension', () => {
  it('is a no-op on the lecturer dimension for single-sibling cohorts (legacy semantics)', () => {
    const candidate = singleSiblingCandidate();
    const gene = buildFlexible(candidate);
    const originalLecturerIds = gene.sessions.map((s) => [...s.lecturerIds]);

    // Force mutation on every gene (mutationRate=1) so we know the gate fires.
    // 100 iterations across the population to amplify any drift.
    for (let i = 0; i < 100; i++) {
      const chrom: Chromosome = [{ ...gene, sessions: gene.sessions.map((s) => ({ ...s, lecturerIds: [...s.lecturerIds] })) }];
      const mutated = mutateChromosome(chrom, [candidate], 1, SLOT_LOOKUP);
      for (let j = 0; j < mutated[0]!.sessions.length; j++) {
        expect(mutated[0]!.sessions[j]!.lecturerIds).toEqual(originalLecturerIds[j]);
      }
    }
  });

  it('keeps mutated lecturerIds within candidate.lecturerPool for multi-sibling cohorts', () => {
    const candidate = multiSiblingSingleLecturerCandidate();
    const pool = new Set(candidate.lecturerPool);
    const gene = buildFlexible(candidate);

    for (let i = 0; i < 200; i++) {
      const chrom: Chromosome = [{ ...gene, sessions: gene.sessions.map((s) => ({ ...s, lecturerIds: [...s.lecturerIds] })) }];
      const mutated = mutateChromosome(chrom, [candidate], 1, SLOT_LOOKUP);
      for (const session of mutated[0]!.sessions) {
        expect(session.lecturerIds.length).toBe(1); // single-lecturer cardinality
        for (const lid of session.lecturerIds) {
          expect(pool.has(lid)).toBe(true);
        }
      }
    }
  });

  it('drifts lecturer assignments across many generations for multi-sibling cohorts', () => {
    const candidate = multiSiblingSingleLecturerCandidate();
    // Seed every session with lecturer 10. Mutation should eventually
    // re-pick lecturer 20 from the pool [10, 20] in at least one session.
    const gene: FlexibleGene = {
      kind: 'FLEXIBLE',
      offeringId: candidate.offeringId,
      sessions: Array.from({ length: candidate.parallelSessionCount }, () => ({
        roomId: 10,
        timeSlotIds: [1],
        lecturerIds: [10],
      })),
    };

    let observedLecturer20 = false;
    for (let i = 0; i < 500 && !observedLecturer20; i++) {
      const chrom: Chromosome = [{ ...gene, sessions: gene.sessions.map((s) => ({ ...s, lecturerIds: [...s.lecturerIds] })) }];
      const mutated = mutateChromosome(chrom, [candidate], 1, SLOT_LOOKUP);
      for (const session of mutated[0]!.sessions) {
        if (session.lecturerIds.includes(20)) {
          observedLecturer20 = true;
          break;
        }
      }
    }
    // Probability of missing lecturer 20 in 500 mutations (each picks one of
    // 4 sessions and chooses uniformly between 2 lecturers) is (1/2)^500,
    // effectively zero — this assertion is statistically guaranteed.
    expect(observedLecturer20).toBe(true);
  });

  it('preserves session cardinality for team-teach sessions in multi-sibling cohorts', () => {
    const candidate = multiSiblingTeamTeachCandidate();
    const gene = buildFlexible(candidate);
    const originalCardinalities = gene.sessions.map((s) => s.lecturerIds.length);

    for (let i = 0; i < 200; i++) {
      const chrom: Chromosome = [{ ...gene, sessions: gene.sessions.map((s) => ({ ...s, lecturerIds: [...s.lecturerIds] })) }];
      const mutated = mutateChromosome(chrom, [candidate], 1, SLOT_LOOKUP);
      for (let j = 0; j < mutated[0]!.sessions.length; j++) {
        expect(mutated[0]!.sessions[j]!.lecturerIds.length).toBe(originalCardinalities[j]);
      }
    }
  });

  it('preserves prior lecturerIds during room/slot mutation when lecturer is not the mutated dimension', () => {
    const candidate = multiSiblingSingleLecturerCandidate();
    const gene = buildFlexible(candidate);
    // Seed each session with a deterministic but distinct lecturer assignment
    // drawn from the pool. After many mutation rounds, at most ONE session
    // per call should diverge from the seed assignment (mutateLecturer
    // picks one random session).
    gene.sessions[0]!.lecturerIds = [10];
    gene.sessions[1]!.lecturerIds = [20];
    gene.sessions[2]!.lecturerIds = [10];
    gene.sessions[3]!.lecturerIds = [20];

    for (let i = 0; i < 100; i++) {
      const chrom: Chromosome = [{ ...gene, sessions: gene.sessions.map((s) => ({ ...s, lecturerIds: [...s.lecturerIds] })) }];
      const mutated = mutateChromosome(chrom, [candidate], 1, SLOT_LOOKUP);
      let diverged = 0;
      const seedAssignments = [[10], [20], [10], [20]];
      for (let j = 0; j < mutated[0]!.sessions.length; j++) {
        if (mutated[0]!.sessions[j]!.lecturerIds[0] !== seedAssignments[j]![0]) {
          diverged++;
        }
      }
      // mutateLecturer modifies at most one session per call; remaining
      // sessions must keep the seed lecturer (proves room/slot mutation
      // didn't reset the lecturer dimension).
      expect(diverged).toBeLessThanOrEqual(1);
    }
  });

  it('skips genes whose mutation gate does not fire (mutationRate=0)', () => {
    const candidate = multiSiblingSingleLecturerCandidate();
    const gene = buildFlexible(candidate);
    const chrom: Chromosome = [{ ...gene, sessions: gene.sessions.map((s) => ({ ...s, lecturerIds: [...s.lecturerIds] })) }];

    const mutated = mutateChromosome(chrom, [candidate], 0, SLOT_LOOKUP);
    // mutationRate=0 means no gene mutates — gene reference is returned as-is.
    expect(mutated[0]).toBe(chrom[0]);
  });
});
