/**
 * ScheduleAssignment repository — Prisma-aware façade for persisting and
 * reading the per-session rows that make up a finished GA run.
 *
 * Phase 1 task 11 (SKS Blocks, Persistence): every parallel session of a
 * `CourseOffering` is stored as its own row, keyed by
 * (runId, offeringId, sessionIndex). The pure mapper at
 * `./mappers/scheduleAssignmentMapper.ts` does the structural translation;
 * this module only orchestrates the runtime Prisma client.
 *
 * Worker integration (Phase 3): the worker writes assignments at run
 * completion via `persistScheduleAssignments`; the API read paths
 * (`GET /schedule-runs/:id`, …) hydrate them via `loadScheduleAssignments`.
 */

import type { PrismaClient } from '@prisma/client';

import type { Chromosome } from '../types';
import {
  chromosomeToScheduleAssignmentWrites,
  mapScheduleAssignmentRow,
  type ScheduleAssignmentRecord,
} from './mappers/scheduleAssignmentMapper';

/**
 * Persist the winning `Chromosome` for `runId`. Each gene fans out into
 * `Gene.sessions.length` rows (one per parallel session) — `sessionIndex`
 * is assigned from the session's position inside `Gene.sessions[]` so the
 * round-trip via `scheduleAssignmentRecordsToChromosome` is deterministic.
 *
 * Wrapped in `$transaction` so a partial write is impossible: the schema's
 * unique `(runId, offeringId, sessionIndex)` index would otherwise allow a
 * crash mid-loop to leave the run with only Session A persisted.
 */
export async function persistScheduleAssignments(
  prisma: PrismaClient,
  runId: string,
  chromosome: Chromosome,
): Promise<void> {
  const writes = chromosomeToScheduleAssignmentWrites(runId, chromosome);
  if (writes.length === 0) return;

  await prisma.$transaction(
    writes.map((w) =>
      prisma.scheduleAssignment.create({
        data: {
          runId: w.runId,
          offeringId: w.offeringId,
          sessionIndex: w.sessionIndex,
          roomId: w.roomId,
          isFixedRoom: w.isFixedRoom,
          slots: w.slots,
          lecturers: w.lecturers,
        },
      }),
    ),
  );
}

/**
 * Load every `ScheduleAssignment` for `runId`, joined with its slot rows.
 * Ordered by `(offeringId, sessionIndex)` so consumers can pass the result
 * straight to `scheduleAssignmentRecordsToChromosome` without re-sorting.
 */
export async function loadScheduleAssignments(
  prisma: PrismaClient,
  runId: string,
): Promise<ScheduleAssignmentRecord[]> {
  const rows = await prisma.scheduleAssignment.findMany({
    where: { runId },
    include: {
      slots: { select: { timeSlotId: true } },
      lecturers: {
        select: { lecturerId: true },
        orderBy: { lecturerId: 'asc' },
      },
    },
    orderBy: [{ offeringId: 'asc' }, { sessionIndex: 'asc' }],
  });

  return rows.map(mapScheduleAssignmentRow);
}
