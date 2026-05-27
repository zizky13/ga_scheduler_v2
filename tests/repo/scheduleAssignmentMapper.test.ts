/**
 * Unit tests for the ScheduleAssignment mapper (Phase 1 task 11).
 *
 * Pure-function tests only — no Prisma runtime. The mapper is the single
 * point of contact between persisted rows and the in-memory `Chromosome`
 * shape, so the round-trip property (`chromosome → writes → records →
 * chromosome`) is the one that must hold.
 */

import { describe, it, expect } from 'vitest';

import type { Chromosome } from '../../src/types';
import {
  mapScheduleAssignmentRow,
  chromosomeToScheduleAssignmentWrites,
  scheduleAssignmentRecordsToChromosome,
  type ScheduleAssignmentRecord,
  type ScheduleAssignmentRow,
} from '../../src/repo';

describe('mapScheduleAssignmentRow', () => {
  it('flattens slots[].timeSlotId into timeSlotIds and preserves sessionIndex', () => {
    const row: ScheduleAssignmentRow = {
      id: 42,
      runId: 'run-abc',
      offeringId: 7,
      sessionIndex: 1,
      roomId: 3,
      isFixedRoom: true,
      manualOverride: false,
      overriddenById: null,
      overriddenAt: null,
      notes: null,
      slots: [{ timeSlotId: 11 }, { timeSlotId: 12 }, { timeSlotId: 13 }],
      lecturers: [{ lecturerId: 500 }, { lecturerId: 600 }],
    };
    const record = mapScheduleAssignmentRow(row);
    expect(record).toEqual({
      id: 42,
      runId: 'run-abc',
      offeringId: 7,
      sessionIndex: 1,
      roomId: 3,
      isFixedRoom: true,
      manualOverride: false,
      overriddenById: null,
      overriddenAt: null,
      notes: null,
      timeSlotIds: [11, 12, 13],
      lecturerIds: [500, 600],
    });
  });

  it('passes through manual override metadata', () => {
    const overriddenAt = new Date('2026-05-07T08:00:00Z');
    const row: ScheduleAssignmentRow = {
      id: 1,
      runId: 'r',
      offeringId: 2,
      sessionIndex: 0,
      roomId: 4,
      isFixedRoom: false,
      manualOverride: true,
      overriddenById: 99,
      overriddenAt,
      notes: 'Kaprodi swap',
      slots: [{ timeSlotId: 5 }],
      lecturers: [{ lecturerId: 77 }],
    };
    const record = mapScheduleAssignmentRow(row);
    expect(record.manualOverride).toBe(true);
    expect(record.overriddenById).toBe(99);
    expect(record.overriddenAt).toBe(overriddenAt);
    expect(record.notes).toBe('Kaprodi swap');
    expect(record.lecturerIds).toEqual([77]);
  });

  it('surfaces [] lecturerIds for legacy rows with no ScheduleAssignmentLecturer joins', () => {
    const row: ScheduleAssignmentRow = {
      id: 3,
      runId: 'legacy-run',
      offeringId: 8,
      sessionIndex: 0,
      roomId: 4,
      isFixedRoom: false,
      manualOverride: false,
      overriddenById: null,
      overriddenAt: null,
      notes: null,
      slots: [{ timeSlotId: 5 }],
      lecturers: [],
    };

    expect(mapScheduleAssignmentRow(row).lecturerIds).toEqual([]);
  });
});

describe('chromosomeToScheduleAssignmentWrites', () => {
  it('emits one write per parallel session with sessionIndex matching position', () => {
    const chromosome: Chromosome = [
      {
        kind: 'FLEXIBLE',
        offeringId: 10,
        sessions: [
          { roomId: 1, timeSlotIds: [1, 2, 3], lecturerIds: [500] },
          { roomId: 2, timeSlotIds: [4, 5, 6], lecturerIds: [600, 700] },
        ],
      },
      {
        kind: 'FIXED',
        offeringId: 20,
        sessions: [{ roomId: 3, timeSlotIds: [7, 8, 9], lecturerIds: [800] }],
      },
    ];
    const writes = chromosomeToScheduleAssignmentWrites('run-1', chromosome);
    expect(writes).toHaveLength(3);

    expect(writes[0]).toEqual({
      runId: 'run-1',
      offeringId: 10,
      sessionIndex: 0,
      roomId: 1,
      isFixedRoom: false,
      slots: { create: [{ timeSlotId: 1 }, { timeSlotId: 2 }, { timeSlotId: 3 }] },
      lecturers: { create: [{ runId: 'run-1', lecturerId: 500 }] },
    });
    expect(writes[1]!.sessionIndex).toBe(1);
    expect(writes[1]!.roomId).toBe(2);
    expect(writes[1]!.lecturers.create).toEqual([
      { runId: 'run-1', lecturerId: 600 },
      { runId: 'run-1', lecturerId: 700 },
    ]);
    expect(writes[2]).toEqual({
      runId: 'run-1',
      offeringId: 20,
      sessionIndex: 0,
      roomId: 3,
      isFixedRoom: true,
      slots: { create: [{ timeSlotId: 7 }, { timeSlotId: 8 }, { timeSlotId: 9 }] },
      lecturers: { create: [{ runId: 'run-1', lecturerId: 800 }] },
    });
  });

  it('returns [] for an empty chromosome', () => {
    expect(chromosomeToScheduleAssignmentWrites('run-x', [])).toEqual([]);
  });
});

describe('scheduleAssignmentRecordsToChromosome (round-trip)', () => {
  it('reconstructs the original chromosome from persisted records', () => {
    const original: Chromosome = [
      {
        kind: 'FLEXIBLE',
        offeringId: 10,
        sessions: [
          { roomId: 1, timeSlotIds: [1, 2, 3], lecturerIds: [500] },
          { roomId: 2, timeSlotIds: [4, 5, 6], lecturerIds: [600, 700] },
        ],
      },
      {
        kind: 'FIXED',
        offeringId: 20,
        sessions: [{ roomId: 3, timeSlotIds: [7, 8, 9], lecturerIds: [800] }],
      },
    ];
    const writes = chromosomeToScheduleAssignmentWrites('run-1', original);
    // Simulate what Prisma would return after a successful write.
    const records: ScheduleAssignmentRecord[] = writes.map((w, i) => ({
      id: i + 1,
      runId: w.runId,
      offeringId: w.offeringId,
      sessionIndex: w.sessionIndex,
      roomId: w.roomId,
      isFixedRoom: w.isFixedRoom,
      manualOverride: false,
      overriddenById: null,
      overriddenAt: null,
      notes: null,
      timeSlotIds: w.slots.create.map((s) => s.timeSlotId),
      lecturerIds: w.lecturers.create.map((l) => l.lecturerId),
    }));

    const rebuilt = scheduleAssignmentRecordsToChromosome(records);
    expect(rebuilt).toEqual(original);
  });

  it('throws when sessionIndex values are non-contiguous', () => {
    const records: ScheduleAssignmentRecord[] = [
      {
        id: 1, runId: 'r', offeringId: 10, sessionIndex: 0,
        roomId: 1, isFixedRoom: false, manualOverride: false,
        overriddenById: null, overriddenAt: null, notes: null,
        timeSlotIds: [1, 2, 3],
        lecturerIds: [500],
      },
      {
        id: 2, runId: 'r', offeringId: 10, sessionIndex: 2, // gap!
        roomId: 2, isFixedRoom: false, manualOverride: false,
        overriddenById: null, overriddenAt: null, notes: null,
        timeSlotIds: [4, 5, 6],
        lecturerIds: [600],
      },
    ];
    expect(() => scheduleAssignmentRecordsToChromosome(records)).toThrow(
      /Non-contiguous sessionIndex/,
    );
  });

  it('throws when sessions of one offering disagree on isFixedRoom', () => {
    const records: ScheduleAssignmentRecord[] = [
      {
        id: 1, runId: 'r', offeringId: 10, sessionIndex: 0,
        roomId: 1, isFixedRoom: false, manualOverride: false,
        overriddenById: null, overriddenAt: null, notes: null,
        timeSlotIds: [1, 2],
        lecturerIds: [500],
      },
      {
        id: 2, runId: 'r', offeringId: 10, sessionIndex: 1,
        roomId: 1, isFixedRoom: true, manualOverride: false,
        overriddenById: null, overriddenAt: null, notes: null,
        timeSlotIds: [3, 4],
        lecturerIds: [500],
      },
    ];
    expect(() => scheduleAssignmentRecordsToChromosome(records)).toThrow(
      /Inconsistent isFixedRoom/,
    );
  });
});

// Phase 15 task #27 — persistence round-trip for the canonical two-lecturer
// team-teach session. Pins the contract the Phase 15 cohort model relies on:
// when a session's `lecturerIds` is `[X, Y]`, (a) the write payload emits
// one `ScheduleAssignmentLecturer` per lecturer in order, and (b) feeding
// those rows back through the read mapper reconstructs the same gene shape.
// Per the `feedback_mapper_tests.md` memory: fixture values stay rule-
// agnostic (no domain rules baked into ids), and the assertions stay
// focused on the mapper's actual behaviour rather than type-required field
// presence already enforced by the compiler.
describe('ScheduleAssignment mapper — Phase 15 #27 round-trip', () => {
  it('round-trips a two-lecturer [X, Y] team-teach session through the join table', () => {
    const X = 500;
    const Y = 600;

    const original: Chromosome = [
      {
        kind: 'FLEXIBLE',
        offeringId: 42,
        sessions: [
          { roomId: 7, timeSlotIds: [1, 2, 3], lecturerIds: [X, Y] },
        ],
      },
    ];

    // Forward direction — chromosome → write payload. The mapper must emit
    // one `lecturers.create` row per lecturer with the run id propagated and
    // the original lecturer order preserved (mirrors the existing
    // `CourseOfferingLecturer` mapper pattern).
    const writes = chromosomeToScheduleAssignmentWrites('run-27', original);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.lecturers.create).toEqual([
      { runId: 'run-27', lecturerId: X },
      { runId: 'run-27', lecturerId: Y },
    ]);

    // Reverse direction — simulate what Prisma returns after the writes
    // land, then feed it back through `scheduleAssignmentRecordsToChromosome`
    // and confirm the round-trip preserves the lecturer list verbatim.
    const records: ScheduleAssignmentRecord[] = writes.map((w, i) => ({
      id: i + 1,
      runId: w.runId,
      offeringId: w.offeringId,
      sessionIndex: w.sessionIndex,
      roomId: w.roomId,
      isFixedRoom: w.isFixedRoom,
      manualOverride: false,
      overriddenById: null,
      overriddenAt: null,
      notes: null,
      timeSlotIds: w.slots.create.map(s => s.timeSlotId),
      lecturerIds: w.lecturers.create.map(l => l.lecturerId),
    }));

    const rebuilt = scheduleAssignmentRecordsToChromosome(records);
    expect(rebuilt).toEqual(original);
    expect(rebuilt[0]!.sessions[0]!.lecturerIds).toEqual([X, Y]);
  });
});
