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

const PHASE16_FRAGMENTED_SLOTS: TimeSlot[] = [
  { id: 101, day: 'Mon', startTime: '08:00', endTime: '08:50' },
  { id: 102, day: 'Mon', startTime: '08:50', endTime: '09:40' },
  { id: 103, day: 'Mon', startTime: '09:40', endTime: '10:30' },
  { id: 104, day: 'Mon', startTime: '10:40', endTime: '11:30' },
  { id: 105, day: 'Mon', startTime: '11:30', endTime: '12:20' },
  { id: 201, day: 'Tue', startTime: '08:00', endTime: '08:50' },
  { id: 202, day: 'Tue', startTime: '09:00', endTime: '09:50' },
  { id: 203, day: 'Tue', startTime: '10:00', endTime: '10:50' },
];

const PHASE16_LOOKUP = buildSlotLookup(PHASE16_FRAGMENTED_SLOTS);

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

function fragmentedFiveSksCandidate(kind: 'FIXED' | 'FLEXIBLE' = 'FLEXIBLE'): PreGACandidate {
  return {
    offeringId: 1607,
    courseId: 16,
    roomId: kind === 'FIXED' ? 31 : null,
    lecturerIds: [77],
    effectiveStudentCount: 30,
    parallelSessionCount: 1,
    sessionDuration: 5,
    possibleTimeSlotIds: PHASE16_FRAGMENTED_SLOTS.map((slot) => slot.id),
    possibleRoomIds: [31, 32],
    isFixedRoom: kind === 'FIXED',
    siblingOfferingIds: [1607],
    lecturerPool: [77],
    siblingLecturerGroups: [[77]],
    longestContiguousRun: 3,
    fragmentationRequired: true,
  };
}

function phase16SlotDays(slotIds: number[]): string[] {
  return slotIds.map((id) => PHASE16_LOOKUP.get(id)!.day);
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

describe('repairChromosome — Phase 16 #7 same-day fragmented fallback', () => {
  it('repairs a conflicted FLEXIBLE session with same-day fragmented slots when no full contiguous block exists', () => {
    const fragmentedCandidate = fragmentedFiveSksCandidate();
    const chrom: Chromosome = [
      {
        kind: 'FLEXIBLE',
        offeringId: fragmentedCandidate.offeringId,
        sessions: [{
          roomId: 31,
          timeSlotIds: [101, 201, 102, 202, 103],
          lecturerIds: [77],
        }],
      },
      {
        kind: 'FLEXIBLE',
        offeringId: 999,
        sessions: [{ roomId: 31, timeSlotIds: [101], lecturerIds: [999] }],
      },
    ];
    const blocker = {
      ...candidate(999, [999], [999]),
      possibleTimeSlotIds: [101],
      possibleRoomIds: [31],
    };

    const repaired = repairChromosome(chrom, [fragmentedCandidate, blocker], PHASE16_LOOKUP);
    const session = repaired[0]!.sessions[0]!;

    expect(session.timeSlotIds).toHaveLength(5);
    expect(new Set(phase16SlotDays(session.timeSlotIds))).toEqual(new Set(['Mon']));
    expect(session.roomId).toBe(32);
  });

  it('preserves FIXED room masking while replacing cross-day slots with same-day fragmented slots', () => {
    const fragmentedCandidate = fragmentedFiveSksCandidate('FIXED');
    const chrom: Chromosome = [
      {
        kind: 'FIXED',
        offeringId: fragmentedCandidate.offeringId,
        sessions: [{
          roomId: 31,
          timeSlotIds: [101, 201, 102, 202, 103],
          lecturerIds: [77],
        }],
      },
      {
        kind: 'FLEXIBLE',
        offeringId: 999,
        sessions: [{ roomId: 31, timeSlotIds: [101], lecturerIds: [999] }],
      },
    ];
    const blocker = {
      ...candidate(999, [999], [999]),
      possibleTimeSlotIds: [101],
      possibleRoomIds: [31],
    };

    const repaired = repairChromosome(chrom, [fragmentedCandidate, blocker], PHASE16_LOOKUP);
    const session = repaired[0]!.sessions[0]!;

    expect(session.roomId).toBe(31);
    expect(session.timeSlotIds).toHaveLength(5);
    expect(new Set(phase16SlotDays(session.timeSlotIds))).toEqual(new Set(['Mon']));
  });
});
