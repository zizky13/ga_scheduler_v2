/**
 * Tests for findContiguousSlots (Task 17) and buildSlotLookup.
 *
 * Uses the same slot layout as src/db/seed.ts:
 *   Mon: 1,2,3   Tue: 4,5,6   Wed: 7,8,9   Thu: 10,11,12   Fri: 13,14,15
 *   Slot times: 08:00-10:00, 10:00-12:00, 13:00-15:00
 *   → Slots 1-2 are contiguous (10:00 == 10:00), but 2-3 are NOT (12:00 ≠ 13:00).
 */

import { describe, it, expect } from 'vitest';
import {
  findContiguousSlots,
  buildSlotLookup,
  type SlotLookup,
} from '../../src/ga/chromosome.js';
import type { TimeSlot } from '../../src/types.js';

// ─── Test Fixtures ───────────────────────────────────────────────

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const slotTimes = [
  { start: '08:00', end: '10:00' },
  { start: '10:00', end: '12:00' },
  { start: '13:00', end: '15:00' },
];

const allTimeSlots: TimeSlot[] = [];
let slotId = 1;
for (const day of days) {
  for (const time of slotTimes) {
    allTimeSlots.push({
      id: slotId++,
      day,
      startTime: time.start,
      endTime: time.end,
    });
  }
}

let lookup: SlotLookup;

// ─── Tests ───────────────────────────────────────────────────────

describe('buildSlotLookup', () => {
  it('should map every slot ID to its TimeSlot', () => {
    lookup = buildSlotLookup(allTimeSlots);
    expect(lookup.size).toBe(15);
    expect(lookup.get(1)).toEqual({
      id: 1, day: 'Monday', startTime: '08:00', endTime: '10:00',
    });
    expect(lookup.get(15)).toEqual({
      id: 15, day: 'Friday', startTime: '13:00', endTime: '15:00',
    });
  });
});

describe('findContiguousSlots', () => {
  // Build lookup once before all tests
  lookup = buildSlotLookup(allTimeSlots);

  // ── Edge cases ─────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should return [] for duration <= 0', () => {
      expect(findContiguousSlots([1, 2, 3], 0, lookup)).toEqual([]);
      expect(findContiguousSlots([1, 2, 3], -1, lookup)).toEqual([]);
    });

    it('should return [] when availableSlotIds is empty', () => {
      expect(findContiguousSlots([], 1, lookup)).toEqual([]);
    });

    it('should return [] when available slots < duration', () => {
      expect(findContiguousSlots([1], 2, lookup)).toEqual([]);
    });

    it('should skip unknown slot IDs gracefully', () => {
      // IDs 999 and 888 don't exist in the lookup
      const blocks = findContiguousSlots([999, 888], 1, lookup);
      expect(blocks).toEqual([]);
    });

    it('should handle mix of known and unknown IDs', () => {
      // Only slot 1 is real; 999 is unknown
      const blocks = findContiguousSlots([1, 999], 1, lookup);
      expect(blocks).toEqual([[1]]);
    });
  });

  // ── Duration = 1 (trivial) ────────────────────────────────────

  describe('duration = 1', () => {
    it('should return each available slot as its own block', () => {
      const blocks = findContiguousSlots([1, 4, 7], 1, lookup);
      const flat = blocks.map(b => b[0]);
      expect(flat).toContain(1);
      expect(flat).toContain(4);
      expect(flat).toContain(7);
      expect(blocks.length).toBe(3);
    });

    it('should return all 15 slots when given all IDs', () => {
      const allIds = allTimeSlots.map(ts => ts.id);
      const blocks = findContiguousSlots(allIds, 1, lookup);
      expect(blocks.length).toBe(15);
    });
  });

  // ── Duration = 2 (back-to-back pair) ──────────────────────────

  describe('duration = 2', () => {
    it('should find the 08:00→10:00→12:00 pair on Monday (slots 1,2)', () => {
      const blocks = findContiguousSlots([1, 2, 3], 2, lookup);
      // Slots 1→2 are contiguous (10:00 == 10:00)
      // Slots 2→3 are NOT contiguous (12:00 ≠ 13:00)
      expect(blocks).toEqual([[1, 2]]);
    });

    it('should not produce a block for slots 2→3 (lunch gap)', () => {
      const blocks = findContiguousSlots([2, 3], 2, lookup);
      expect(blocks).toEqual([]);
    });

    it('should find contiguous pairs across multiple days', () => {
      // Mon: 1,2 | Tue: 4,5 | Wed: 7,8
      const blocks = findContiguousSlots([1, 2, 4, 5, 7, 8], 2, lookup);
      expect(blocks.length).toBe(3);
      expect(blocks).toContainEqual([1, 2]);
      expect(blocks).toContainEqual([4, 5]);
      expect(blocks).toContainEqual([7, 8]);
    });
  });

  // ── Duration = 3 (full morning + afternoon test) ──────────────

  describe('duration = 3', () => {
    it('should return [] because lunch gap breaks the chain (standard layout)', () => {
      // Mon has slots 1(08-10), 2(10-12), 3(13-15)
      // Chain: 1→2 contiguous (10:00==10:00), but 2→3 has gap (12:00≠13:00)
      const blocks = findContiguousSlots([1, 2, 3], 3, lookup);
      expect(blocks).toEqual([]);
    });

    it('should work with a custom layout that has 3 back-to-back slots', () => {
      // Create a custom timetable with 3 contiguous morning slots
      const customSlots: TimeSlot[] = [
        { id: 101, day: 'Monday', startTime: '08:00', endTime: '09:00' },
        { id: 102, day: 'Monday', startTime: '09:00', endTime: '10:00' },
        { id: 103, day: 'Monday', startTime: '10:00', endTime: '11:00' },
        { id: 104, day: 'Monday', startTime: '13:00', endTime: '14:00' }, // gap
      ];
      const customLookup = buildSlotLookup(customSlots);
      const blocks = findContiguousSlots([101, 102, 103, 104], 3, customLookup);
      expect(blocks).toEqual([[101, 102, 103]]);
    });
  });

  // ── Cross-day rejection ────────────────────────────────────────

  describe('cross-day rejection', () => {
    it('should NOT bridge across days even if IDs are consecutive', () => {
      // Slot 3 = Mon 13:00-15:00, Slot 4 = Tue 08:00-10:00
      // Even though slot IDs are adjacent, they are on different days
      const blocks = findContiguousSlots([3, 4], 2, lookup);
      expect(blocks).toEqual([]);
    });
  });

  // ── Slot order independence ────────────────────────────────────

  describe('slot order independence', () => {
    it('should find contiguous blocks regardless of input order', () => {
      // Reverse order: should still find [1, 2]
      const blocks = findContiguousSlots([2, 1], 2, lookup);
      expect(blocks).toEqual([[1, 2]]);
    });

    it('should handle scattered IDs across days', () => {
      // Slots from Mon (1,2) and Fri (13,14) — both days have a contiguous pair
      const blocks = findContiguousSlots([14, 1, 13, 2], 2, lookup);
      expect(blocks.length).toBe(2);
      expect(blocks).toContainEqual([1, 2]);
      expect(blocks).toContainEqual([13, 14]);
    });
  });

  // ── Multiple blocks from a single long chain ──────────────────

  describe('multiple overlapping windows from one chain', () => {
    it('should extract sliding windows from a long chain', () => {
      // Create 4 contiguous slots on Monday
      const customSlots: TimeSlot[] = [
        { id: 201, day: 'Monday', startTime: '08:00', endTime: '09:00' },
        { id: 202, day: 'Monday', startTime: '09:00', endTime: '10:00' },
        { id: 203, day: 'Monday', startTime: '10:00', endTime: '11:00' },
        { id: 204, day: 'Monday', startTime: '11:00', endTime: '12:00' },
      ];
      const customLookup = buildSlotLookup(customSlots);

      // Duration = 2 → windows: [201,202], [202,203], [203,204]
      const blocks2 = findContiguousSlots([201, 202, 203, 204], 2, customLookup);
      expect(blocks2.length).toBe(3);
      expect(blocks2).toContainEqual([201, 202]);
      expect(blocks2).toContainEqual([202, 203]);
      expect(blocks2).toContainEqual([203, 204]);

      // Duration = 3 → windows: [201,202,203], [202,203,204]
      const blocks3 = findContiguousSlots([201, 202, 203, 204], 3, customLookup);
      expect(blocks3.length).toBe(2);
      expect(blocks3).toContainEqual([201, 202, 203]);
      expect(blocks3).toContainEqual([202, 203, 204]);
    });
  });

  // ── Realistic seed scenario ────────────────────────────────────

  describe('realistic seed layout', () => {
    it('should find exactly 5 contiguous-2 blocks (one per day) with all slots', () => {
      // With the seed layout (3 slots/day, lunch gap between slot 2 and 3):
      //   Each day has: [08-10, 10-12, 13-15]
      //   Only 08-10 → 10-12 is contiguous. So 5 days × 1 pair = 5 blocks.
      const allIds = allTimeSlots.map(ts => ts.id);
      const blocks = findContiguousSlots(allIds, 2, lookup);
      expect(blocks.length).toBe(5);
      expect(blocks).toContainEqual([1, 2]);   // Mon
      expect(blocks).toContainEqual([4, 5]);   // Tue
      expect(blocks).toContainEqual([7, 8]);   // Wed
      expect(blocks).toContainEqual([10, 11]); // Thu
      expect(blocks).toContainEqual([13, 14]); // Fri
    });

    it('should find 0 contiguous-3 blocks with the standard seed layout', () => {
      // Lunch gap prevents any chain of 3 in the seed layout
      const allIds = allTimeSlots.map(ts => ts.id);
      const blocks = findContiguousSlots(allIds, 3, lookup);
      expect(blocks.length).toBe(0);
    });
  });

  // ── Sparse availability ────────────────────────────────────────

  describe('sparse availability', () => {
    it('should return [] when only afternoon slots are available (no pairs)', () => {
      // Afternoon-only: slots 3, 6, 9, 12, 15 — each isolated on its day
      const blocks = findContiguousSlots([3, 6, 9, 12, 15], 2, lookup);
      expect(blocks).toEqual([]);
    });

    it('should find pairs only where both morning slots are available', () => {
      // Available: Mon morning pair (1,2) + random afternoon slots
      const blocks = findContiguousSlots([1, 2, 6, 9, 15], 2, lookup);
      expect(blocks).toEqual([[1, 2]]);
    });
  });
});
