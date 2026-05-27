/**
 * Phase 15 #9 — per-session lecturer-aware repair.
 *
 * These tests deliberately make candidate.lecturerIds differ from the
 * session-level lecturerIds so regressions that read the legacy candidate
 * field instead of `GeneSession.lecturerIds` are visible.
 */

import { describe, expect, it } from 'vitest';
import { buildSlotLookup } from '../../src/ga/chromosome.js';
import { repairChromosome } from '../../src/ga/repair.js';
import type { Chromosome, FlexibleGene, PreGACandidate, TimeSlot } from '../../src/types.js';

const TIME_SLOTS: TimeSlot[] = [
  { id: 1, day: 'Mon', startTime: '08:00', endTime: '09:00' },
  { id: 2, day: 'Mon', startTime: '09:00', endTime: '10:00' },
  { id: 3, day: 'Tue', startTime: '08:00', endTime: '09:00' },
];

const SLOT_LOOKUP = buildSlotLookup(TIME_SLOTS);

function candidate(
  offeringId: number,
  lecturerIds: number[],
  lecturerPool: number[],
): PreGACandidate {
  return {
    offeringId,
    courseId: offeringId,
    roomId: null,
    lecturerIds,
    effectiveStudentCount: 30,
    parallelSessionCount: 1,
    sessionDuration: 1,
    possibleTimeSlotIds: [1, 2, 3],
    possibleRoomIds: [1, 2, 3],
    isFixedRoom: false,
    siblingOfferingIds: [offeringId],
    lecturerPool,
    siblingLecturerGroups: [lecturerIds],
  };
}

function flex(offeringId: number, roomId: number, slotId: number, lecturerIds: number[]): FlexibleGene {
  return {
    kind: 'FLEXIBLE',
    offeringId,
    sessions: [{ roomId, timeSlotIds: [slotId], lecturerIds }],
  };
}

describe('repairChromosome — Phase 15 #9 lecturer dimension', () => {
  it('swaps a session lecturer from lecturerPool before moving the contiguous block', () => {
    const chrom: Chromosome = [
      flex(1, 1, 1, [10]),
      flex(2, 2, 1, [10]),
    ];
    const candidates = [
      candidate(1, [99], [10, 20]),
      candidate(2, [98], [10]),
    ];

    const repaired = repairChromosome(chrom, candidates, SLOT_LOOKUP);

    expect(repaired[0]!.sessions[0]!.roomId).toBe(1);
    expect(repaired[0]!.sessions[0]!.timeSlotIds).toEqual([1]);
    expect(repaired[0]!.sessions[0]!.lecturerIds).toEqual([20]);
  });

  it('uses session-level lecturerIds in the legacy greedy repair path', () => {
    const chrom: Chromosome = [
      flex(1, 1, 1, [10]),
      flex(2, 2, 1, [10]),
    ];
    const candidates = [
      candidate(1, [99], [10, 20]),
      candidate(2, [98], [10]),
    ];

    const repaired = repairChromosome(chrom, candidates);

    expect(repaired[0]!.sessions[0]!.roomId).toBe(1);
    expect(repaired[0]!.sessions[0]!.timeSlotIds).toEqual([1]);
    expect(repaired[0]!.sessions[0]!.lecturerIds).toEqual([20]);
  });
});
