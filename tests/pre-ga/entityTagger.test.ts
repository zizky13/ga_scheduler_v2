/**
 * Unit tests for `tagEntities` (src/pre-ga/entityTagger.ts).
 *
 * Covers Phase 7's nullable `CourseOffering.roomId` migration: when the
 * candidate arrives with `roomId === null`, an active LockedRoom must still
 * drive the final candidate room (the lock branch overwrites unconditionally).
 * Non-null and unlocked paths are also exercised to guard regressions.
 */

import { describe, it, expect } from 'vitest';
import { tagEntities } from '../../src/pre-ga/entityTagger.js';
import type { PreGACandidate } from '../../src/types.js';

function buildCandidate(overrides: Partial<PreGACandidate> = {}): PreGACandidate {
  return {
    offeringId: 1,
    courseId: 10,
    roomId: 5,
    lecturerIds: [100],
    parallelSessionCount: 1,
    sessionDuration: 1,
    possibleTimeSlotIds: [1, 2, 3],
    possibleRoomIds: [1, 2, 3, 4, 5],
    isFixedRoom: false,
    ...overrides,
  };
}

describe('tagEntities — lock override is null-safe', () => {
  it('drives the locked room id when the candidate has a non-null roomId', () => {
    const candidate = buildCandidate({ offeringId: 1, roomId: 5 });
    const lockedRoomMap = new Map<number, number>([[1, 9]]);

    const [tagged] = tagEntities([candidate], lockedRoomMap);

    expect(tagged!.isFixedRoom).toBe(true);
    expect(tagged!.roomId).toBe(9);
  });

  it('drives the locked room id even when the candidate has a null roomId (Phase 7)', () => {
    const candidate = buildCandidate({ offeringId: 1, roomId: null });
    const lockedRoomMap = new Map<number, number>([[1, 12]]);

    const [tagged] = tagEntities([candidate], lockedRoomMap);

    expect(tagged!.isFixedRoom).toBe(true);
    expect(tagged!.roomId).toBe(12);
  });

  it('preserves a null roomId when no lock exists (GA will seed from possibleRoomIds)', () => {
    const candidate = buildCandidate({ offeringId: 1, roomId: null });
    const lockedRoomMap = new Map<number, number>();

    const [tagged] = tagEntities([candidate], lockedRoomMap);

    expect(tagged!.isFixedRoom).toBe(false);
    expect(tagged!.roomId).toBeNull();
  });

  it('preserves a non-null roomId when no lock exists', () => {
    const candidate = buildCandidate({ offeringId: 1, roomId: 5 });
    const lockedRoomMap = new Map<number, number>();

    const [tagged] = tagEntities([candidate], lockedRoomMap);

    expect(tagged!.isFixedRoom).toBe(false);
    expect(tagged!.roomId).toBe(5);
  });

  it('tags each candidate independently in a batch (mix of null + locked + unlocked)', () => {
    const candidates = [
      buildCandidate({ offeringId: 1, roomId: null }), // locked → must take id 21
      buildCandidate({ offeringId: 2, roomId: 7 }),    // unlocked → keep 7
      buildCandidate({ offeringId: 3, roomId: null }), // unlocked → keep null
    ];
    const lockedRoomMap = new Map<number, number>([[1, 21]]);

    const tagged = tagEntities(candidates, lockedRoomMap);

    expect(tagged[0]!.isFixedRoom).toBe(true);
    expect(tagged[0]!.roomId).toBe(21);
    expect(tagged[1]!.isFixedRoom).toBe(false);
    expect(tagged[1]!.roomId).toBe(7);
    expect(tagged[2]!.isFixedRoom).toBe(false);
    expect(tagged[2]!.roomId).toBeNull();
  });
});
