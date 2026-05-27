/**
 * ScheduleAssignment mapper — Prisma `schedule_assignments` row (+ joined
 * `schedule_assignment_slots` + `schedule_assignment_lecturers`) to a plain
 * TS record, plus the inverse direction: turning a GA `Chromosome` into the
 * create-payloads the worker will pass to nested Prisma writes.
 *
 * Phase 1 task 11 (SKS Blocks, Persistence): each parallel session of a
 * `CourseOffering` is persisted as its own row, keyed by
 * (runId, offeringId, sessionIndex). The `sessionIndex` is the 0-based
 * ordinal of the session within `Gene.sessions[]` — Session A=0, B=1, …
 *
 * Pure module: no Prisma runtime import. The row type is structural so this
 * compiles against either Prisma provider variant (Postgres/SQLite).
 */

import type { Chromosome, Gene } from '../../types';

/** Shape of a Prisma `schedule_assignments` row with its slot/lecturer joins. */
export interface ScheduleAssignmentRow {
  id: number;
  runId: string;
  offeringId: number;
  sessionIndex: number;
  roomId: number;
  isFixedRoom: boolean;
  manualOverride: boolean;
  overriddenById: number | null;
  overriddenAt: Date | null;
  notes: string | null;
  slots: ReadonlyArray<{ timeSlotId: number }>;
  lecturers: ReadonlyArray<{ lecturerId: number }>;
}

/**
 * Plain TS shape returned across the repository boundary. Slot ids are
 * flattened into a `timeSlotIds` array — the join row itself never escapes
 * the repo.
 */
export interface ScheduleAssignmentRecord {
  id: number;
  runId: string;
  offeringId: number;
  /** 0-based parallel-session ordinal (Session A = 0, Session B = 1, …). */
  sessionIndex: number;
  roomId: number;
  isFixedRoom: boolean;
  manualOverride: boolean;
  overriddenById: number | null;
  overriddenAt: Date | null;
  notes: string | null;
  /** Contiguous, same-day slot ids (length === offering's sessionDuration). */
  timeSlotIds: number[];
  /**
   * Phase 15 #15 / OQ-29: per-session lecturers are stored in the
   * `ScheduleAssignmentLecturer` join table. Legacy rows with no join entries
   * surface as `[]` for OQ-30 backward compatibility.
   */
  lecturerIds: number[];
}

/** Read direction: Prisma row → domain record. */
export function mapScheduleAssignmentRow(
  row: ScheduleAssignmentRow,
): ScheduleAssignmentRecord {
  return {
    id: row.id,
    runId: row.runId,
    offeringId: row.offeringId,
    sessionIndex: row.sessionIndex,
    roomId: row.roomId,
    isFixedRoom: row.isFixedRoom,
    manualOverride: row.manualOverride,
    overriddenById: row.overriddenById,
    overriddenAt: row.overriddenAt,
    notes: row.notes,
    timeSlotIds: row.slots.map((s) => s.timeSlotId),
    lecturerIds: row.lecturers.map((l) => l.lecturerId),
  };
}

/**
 * Shape of the write-side payload. Mirrors what `prisma.scheduleAssignment
 * .create({ data: { …, slots: { create: [{ timeSlotId }] } } })` expects, but
 * stays structural so this module never depends on the runtime client.
 */
export interface ScheduleAssignmentWriteInput {
  runId: string;
  offeringId: number;
  sessionIndex: number;
  roomId: number;
  isFixedRoom: boolean;
  /** One entry per slot in the contiguous block. */
  slots: { create: Array<{ timeSlotId: number }> };
  /** One entry per lecturer assigned to this persisted session. */
  lecturers: { create: Array<{ runId: string; lecturerId: number }> };
}

/**
 * Write direction: explode a winning `Chromosome` into one
 * `ScheduleAssignmentWriteInput` per parallel session, with `sessionIndex`
 * matching the position of the session inside `Gene.sessions[]`.
 *
 * The output preserves chromosome order and, within each gene, session
 * order — so the persisted `sessionIndex` matches the in-memory
 * representation 1:1 (important for round-trip property tests).
 */
export function chromosomeToScheduleAssignmentWrites(
  runId: string,
  chromosome: Chromosome,
): ScheduleAssignmentWriteInput[] {
  const writes: ScheduleAssignmentWriteInput[] = [];
  for (const gene of chromosome) {
    const isFixedRoom = gene.kind === 'FIXED';
    for (let sessionIndex = 0; sessionIndex < gene.sessions.length; sessionIndex++) {
      const session = gene.sessions[sessionIndex]!;
      writes.push({
        runId,
        offeringId: gene.offeringId,
        sessionIndex,
        roomId: session.roomId,
        isFixedRoom,
        slots: {
          create: session.timeSlotIds.map((timeSlotId) => ({ timeSlotId })),
        },
        // note (Phase 15 #15 / OQ-29): per-session lecturer assignment is a
        // relational join, matching CourseOfferingLecturer's table-per-array
        // pattern. `runId` is intentionally denormalized on the join row so
        // read paths can filter by run without joining through assignments.
        lecturers: {
          create: session.lecturerIds.map((lecturerId) => ({ runId, lecturerId })),
        },
      });
    }
  }
  return writes;
}

/**
 * Inverse of {@link chromosomeToScheduleAssignmentWrites}: rebuild the GA
 * `Chromosome` from a flat list of persisted records. Records are grouped by
 * `offeringId`, ordered by `sessionIndex`, so the returned chromosome is a
 * deterministic projection of what was originally written.
 *
 * Throws when a gene's session indices are non-contiguous (e.g. `[0, 2]`):
 * that always indicates a data corruption — the unique constraint on
 * `(runId, offeringId, sessionIndex)` must be respected by every writer.
 */
export function scheduleAssignmentRecordsToChromosome(
  records: ReadonlyArray<ScheduleAssignmentRecord>,
): Chromosome {
  const byOffering = new Map<number, ScheduleAssignmentRecord[]>();
  for (const r of records) {
    const bucket = byOffering.get(r.offeringId) ?? [];
    bucket.push(r);
    byOffering.set(r.offeringId, bucket);
  }

  const chromosome: Chromosome = [];
  for (const [offeringId, sessions] of byOffering) {
    sessions.sort((a, b) => a.sessionIndex - b.sessionIndex);

    for (let i = 0; i < sessions.length; i++) {
      if (sessions[i]!.sessionIndex !== i) {
        throw new Error(
          `Non-contiguous sessionIndex for offering ${offeringId}: ` +
            `expected ${i}, got ${sessions[i]!.sessionIndex}. ` +
            `Persistence layer must guarantee gap-free session ordinals.`,
        );
      }
    }

    const isFixedRoom = sessions[0]!.isFixedRoom;
    // Sanity check: all sessions for one offering must agree on isFixedRoom.
    for (const s of sessions) {
      if (s.isFixedRoom !== isFixedRoom) {
        throw new Error(
          `Inconsistent isFixedRoom for offering ${offeringId}: ` +
            `sessionIndex=${s.sessionIndex} disagrees with sessionIndex=0`,
        );
      }
    }

    const geneSessions = sessions.map((s) => ({
      roomId: s.roomId,
      timeSlotIds: [...s.timeSlotIds],
      // note (Phase 15 #15 / OQ-29): persisted per-session lecturerIds come
      // from ScheduleAssignmentLecturer. Legacy pre-Phase-15 assignments have
      // no join rows, so they naturally reconstruct as [] for OQ-30.
      lecturerIds: [...s.lecturerIds],
    }));

    const gene: Gene = isFixedRoom
      ? { kind: 'FIXED', offeringId, sessions: geneSessions }
      : { kind: 'FLEXIBLE', offeringId, sessions: geneSessions };

    chromosome.push(gene);
  }

  return chromosome;
}
