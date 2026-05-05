/**
 * Layer 2 (SSA Phase 0) — Static Exclusion unit tests.
 *
 * Mirrors the test outline in techspec §10.1:
 *   ├── Locks correct (roomId, slotId) coordinates from fixed candidates
 *   ├── Removes locked coordinates from flexible candidates sharing the same room
 *   ├── Does not modify candidates in different rooms
 *   └── Fixed candidates pass through unchanged
 */

import { describe, it, expect } from 'vitest';
import { runStaticExclusion } from '../../src/ssa/staticExclusion.js';
import type { PreGACandidate } from '../../src/types.js';

function buildCandidate(args: {
  offeringId: number;
  roomId: number;
  isFixedRoom: boolean;
  possibleTimeSlotIds: number[];
  lecturerIds?: number[];
  parallelSessionCount?: number;
  fixedTimeSlotIds?: number[];
}): PreGACandidate {
  return {
    offeringId: args.offeringId,
    courseId: args.offeringId * 10,
    roomId: args.roomId,
    lecturerIds: args.lecturerIds ?? [args.offeringId],
    parallelSessionCount: args.parallelSessionCount ?? (args.possibleTimeSlotIds.length || 1),
    sessionDuration: 1,
    possibleTimeSlotIds: args.possibleTimeSlotIds,
    isFixedRoom: args.isFixedRoom,
    ...(args.fixedTimeSlotIds ? { fixedTimeSlotIds: args.fixedTimeSlotIds } : {}),
  };
}

describe('runStaticExclusion (techspec §10.1)', () => {
  it('locks correct (roomId, slotId) coordinates from fixed candidates', () => {
    const candidates: PreGACandidate[] = [
      buildCandidate({
        offeringId: 1,
        roomId: 10,
        isFixedRoom: true,
        possibleTimeSlotIds: [1, 2],
        fixedTimeSlotIds: [1, 2],
      }),
      buildCandidate({
        offeringId: 2,
        roomId: 20,
        isFixedRoom: true,
        possibleTimeSlotIds: [3],
        fixedTimeSlotIds: [3],
      }),
    ];

    const { lockedCoordinates } = runStaticExclusion(candidates);

    expect(lockedCoordinates.size).toBe(3);
    expect(lockedCoordinates.has('10:1')).toBe(true);
    expect(lockedCoordinates.has('10:2')).toBe(true);
    expect(lockedCoordinates.has('20:3')).toBe(true);
  });

  it('removes locked coordinates from flexible candidates sharing the same room', () => {
    const candidates: PreGACandidate[] = [
      buildCandidate({
        offeringId: 1,
        roomId: 10,
        isFixedRoom: true,
        possibleTimeSlotIds: [1, 2],
        fixedTimeSlotIds: [1, 2],
      }),
      buildCandidate({
        offeringId: 2,
        roomId: 10,
        isFixedRoom: false,
        possibleTimeSlotIds: [1, 2, 3, 4],
      }),
    ];

    const { prunedCandidates } = runStaticExclusion(candidates);
    const flexible = prunedCandidates.find(c => c.offeringId === 2)!;

    expect(flexible.possibleTimeSlotIds).toEqual([3, 4]);
  });

  it('does not modify candidates in different rooms', () => {
    const candidates: PreGACandidate[] = [
      buildCandidate({
        offeringId: 1,
        roomId: 10,
        isFixedRoom: true,
        possibleTimeSlotIds: [1, 2],
        fixedTimeSlotIds: [1, 2],
      }),
      buildCandidate({
        offeringId: 2,
        roomId: 20,
        isFixedRoom: false,
        possibleTimeSlotIds: [1, 2, 3, 4],
      }),
    ];

    const { prunedCandidates } = runStaticExclusion(candidates);
    const flexible = prunedCandidates.find(c => c.offeringId === 2)!;

    expect(flexible.possibleTimeSlotIds).toEqual([1, 2, 3, 4]);
  });

  it('fixed candidates pass through unchanged', () => {
    const fixedCandidate = buildCandidate({
      offeringId: 1,
      roomId: 10,
      isFixedRoom: true,
      possibleTimeSlotIds: [1, 2],
      fixedTimeSlotIds: [1, 2],
    });
    const otherFixedSameRoom = buildCandidate({
      offeringId: 3,
      roomId: 10,
      isFixedRoom: true,
      possibleTimeSlotIds: [5],
      fixedTimeSlotIds: [5],
    });
    const candidates: PreGACandidate[] = [fixedCandidate, otherFixedSameRoom];

    const { prunedCandidates } = runStaticExclusion(candidates);
    const passedThrough = prunedCandidates.find(c => c.offeringId === 1)!;
    const otherPassedThrough = prunedCandidates.find(c => c.offeringId === 3)!;

    expect(passedThrough).toBe(fixedCandidate);
    expect(passedThrough.possibleTimeSlotIds).toEqual([1, 2]);
    expect(otherPassedThrough).toBe(otherFixedSameRoom);
    expect(otherPassedThrough.possibleTimeSlotIds).toEqual([5]);
  });

  it('returns empty locked set and untouched flexible candidates when no fixed candidates exist', () => {
    const flex = buildCandidate({
      offeringId: 1,
      roomId: 10,
      isFixedRoom: false,
      possibleTimeSlotIds: [1, 2, 3],
    });
    const { lockedCoordinates, prunedCandidates } = runStaticExclusion([flex]);

    expect(lockedCoordinates.size).toBe(0);
    expect(prunedCandidates).toHaveLength(1);
    expect(prunedCandidates[0]!.possibleTimeSlotIds).toEqual([1, 2, 3]);
  });

  it('handles empty input gracefully', () => {
    const { lockedCoordinates, prunedCandidates } = runStaticExclusion([]);
    expect(lockedCoordinates.size).toBe(0);
    expect(prunedCandidates).toEqual([]);
  });

  it('flexible domain becomes empty when every slot it wants is locked in its room', () => {
    const candidates: PreGACandidate[] = [
      buildCandidate({
        offeringId: 1,
        roomId: 10,
        isFixedRoom: true,
        possibleTimeSlotIds: [1, 2],
        fixedTimeSlotIds: [1, 2],
      }),
      buildCandidate({
        offeringId: 2,
        roomId: 10,
        isFixedRoom: false,
        possibleTimeSlotIds: [1, 2],
      }),
    ];

    const { prunedCandidates } = runStaticExclusion(candidates);
    const flexible = prunedCandidates.find(c => c.offeringId === 2)!;

    expect(flexible.possibleTimeSlotIds).toEqual([]);
  });
});
