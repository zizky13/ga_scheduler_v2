import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { persistScheduleAssignments } from '../../src/repo/scheduleAssignmentRepo';
import type { Chromosome } from '../../src/types';

describe('persistScheduleAssignments', () => {
  it('creates ScheduleAssignment rows and batches per-session lecturer joins', async () => {
    const assignmentCreate = vi.fn(async ({ data }: { data: { sessionIndex: number } }) => ({
      id: 100 + data.sessionIndex,
    }));
    const lecturerCreateMany = vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => ({
      count: data.length,
    }));
    const transaction = vi.fn(async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        scheduleAssignment: { create: assignmentCreate },
        scheduleAssignmentLecturer: { createMany: lecturerCreateMany },
      }),
    );
    const prisma = { $transaction: transaction } as unknown as PrismaClient;
    const chromosome: Chromosome = [
      {
        kind: 'FLEXIBLE',
        offeringId: 10,
        sessions: [
          { roomId: 1, timeSlotIds: [1, 2], lecturerIds: [500] },
          { roomId: 2, timeSlotIds: [3, 4], lecturerIds: [600, 700] },
        ],
      },
    ];

    await persistScheduleAssignments(prisma, 'run-1', chromosome);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(assignmentCreate).toHaveBeenCalledTimes(2);
    expect(assignmentCreate).toHaveBeenNthCalledWith(1, {
      data: {
        runId: 'run-1',
        offeringId: 10,
        sessionIndex: 0,
        roomId: 1,
        isFixedRoom: false,
        slots: { create: [{ timeSlotId: 1 }, { timeSlotId: 2 }] },
      },
    });
    expect(lecturerCreateMany).toHaveBeenCalledTimes(2);
    expect(lecturerCreateMany).toHaveBeenNthCalledWith(1, {
      data: [{ runId: 'run-1', assignmentId: 100, lecturerId: 500 }],
    });
    expect(lecturerCreateMany).toHaveBeenNthCalledWith(2, {
      data: [
        { runId: 'run-1', assignmentId: 101, lecturerId: 600 },
        { runId: 'run-1', assignmentId: 101, lecturerId: 700 },
      ],
    });
  });
});
