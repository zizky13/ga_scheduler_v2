/**
 * `ScheduleRun` repository for the API layer (api_design §5.3.8, §7.1).
 *
 * The route handler in `src/api/routes/schedule-runs.ts` uses this to:
 *   - look up an existing run by `Idempotency-Key` (api_design §7),
 *   - count offerings for a `semesterId` to enforce the 422
 *     `NO_ACTIVE_SEMESTER` error path (api_design §5.3.8),
 *   - insert a new `QUEUED` run before enqueueing the BullMQ job,
 *   - mark a run `FAILED` if the queue is unreachable so the row is not
 *     orphaned in `QUEUED`.
 *
 * The worker has its own direct Prisma access in `src/worker/index.ts` —
 * this facade is API-side only. Keeping the surface tight here also keeps
 * the test fakes in `tests/api/routes/_crudFixture.ts` small.
 */

import type { PrismaClient, RunStatus } from '@prisma/client';

export interface ScheduleRunRow {
  id: string;
  semesterId: number;
  createdById: number;
  status: RunStatus;
  configJson: string;
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface CreateScheduleRunInput {
  semesterId: number;
  createdById: number;
  configJson: string;
  idempotencyKey?: string | null;
}

export interface ScheduleRunRepository {
  findByIdempotencyKey(key: string): Promise<ScheduleRunRow | null>;
  countOfferingsForSemester(semesterId: number): Promise<number>;
  create(input: CreateScheduleRunInput): Promise<ScheduleRunRow>;
  markFailed(id: string, errorCode: string, errorMessage: string): Promise<void>;
}

const SCHEDULE_RUN_SUMMARY_SELECT = {
  id: true,
  semesterId: true,
  createdById: true,
  status: true,
  configJson: true,
  idempotencyKey: true,
  createdAt: true,
} as const;

export function createScheduleRunRepository(
  prisma: PrismaClient,
): ScheduleRunRepository {
  return {
    async findByIdempotencyKey(key) {
      return prisma.scheduleRun.findUnique({
        where: { idempotencyKey: key },
        select: SCHEDULE_RUN_SUMMARY_SELECT,
      });
    },
    async countOfferingsForSemester(semesterId) {
      return prisma.courseOffering.count({ where: { semesterId } });
    },
    async create(input) {
      return prisma.scheduleRun.create({
        data: {
          semesterId: input.semesterId,
          createdById: input.createdById,
          configJson: input.configJson,
          idempotencyKey: input.idempotencyKey ?? null,
          // status defaults to QUEUED in the schema; specifying it here keeps
          // the intent local-readable even if the default ever changes.
          status: 'QUEUED',
        },
        select: SCHEDULE_RUN_SUMMARY_SELECT,
      });
    },
    async markFailed(id, errorCode, errorMessage) {
      await prisma.scheduleRun.update({
        where: { id },
        data: {
          status: 'FAILED',
          errorCode,
          errorMessage,
          completedAt: new Date(),
        },
      });
    },
  };
}
