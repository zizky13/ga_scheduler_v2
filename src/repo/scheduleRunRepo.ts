/**
 * `ScheduleRun` repository for the API layer (api_design §5.3.8, §7.1).
 *
 * Used by:
 *   - `POST /schedule-runs` — Idempotency-Key lookup + offering count gate +
 *     create + markFailed (Phase 3 Task 5).
 *   - `GET /schedule-runs` (list, summary projection),
 *     `GET /schedule-runs/:id` (full + nested assignments),
 *     `DELETE /schedule-runs/:id` (hard delete; cascades via the schema).
 *     (Phase 3 Task 6.)
 *
 * Owner-vs-admin filtering is enforced in the route handler by injecting
 * `filter.createdById = req.user.id` when the caller is `user`. The repo
 * just honours whatever filter it's handed.
 *
 * The worker has its own direct Prisma access in `src/worker/index.ts` —
 * this facade is API-side only.
 */

import type { Prisma, PrismaClient, RunStatus } from '@prisma/client';

// ─── Slim row used by the POST /schedule-runs handler ────────────────────

export interface ScheduleRunRow {
  id: string;
  semesterId: number;
  createdById: number;
  status: RunStatus;
  configJson: string;
  idempotencyKey: string | null;
  createdAt: Date;
}

const SCHEDULE_RUN_SLIM_SELECT = {
  id: true,
  semesterId: true,
  createdById: true,
  status: true,
  configJson: true,
  idempotencyKey: true,
  createdAt: true,
} as const;

export interface CreateScheduleRunInput {
  semesterId: number;
  createdById: number;
  configJson: string;
  idempotencyKey?: string | null;
}

// ─── Summary row used by GET /schedule-runs (list) ───────────────────────

/**
 * Wire shape of one row in `GET /schedule-runs` list responses
 * (api_design §5.3.8). Heavy JSON fields (`historyJson`, `configJson`, …)
 * are intentionally omitted to keep the list response small.
 */
export interface ScheduleRunSummaryRecord {
  id: string;
  semesterId: number;
  createdById: number;
  status: RunStatus;
  bestFitness: number;
  hardViolations: number;
  softPenalty: number;
  competencyMismatch: number;
  loadPenalty: number;
  generationsRun: number;
  currentGeneration: number;
  stagnatedEarly: boolean;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

const SCHEDULE_RUN_SUMMARY_SELECT = {
  id: true,
  semesterId: true,
  createdById: true,
  status: true,
  bestFitness: true,
  hardViolations: true,
  softPenalty: true,
  competencyMismatch: true,
  loadPenalty: true,
  generationsRun: true,
  currentGeneration: true,
  stagnatedEarly: true,
  durationMs: true,
  errorCode: true,
  errorMessage: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} as const;

// ─── Detail row used by GET /schedule-runs/:id ───────────────────────────

export interface ScheduleRunDetailRecord extends ScheduleRunSummaryRecord {
  configJson: string;
  preGASummaryJson: string | null;
  ssaResultJson: string | null;
  historyJson: string;
  avgHistoryJson: string;
  idempotencyKey: string | null;
}

const SCHEDULE_RUN_DETAIL_SELECT = {
  ...SCHEDULE_RUN_SUMMARY_SELECT,
  configJson: true,
  preGASummaryJson: true,
  ssaResultJson: true,
  historyJson: true,
  avgHistoryJson: true,
  idempotencyKey: true,
} as const;

// ─── Assignment row joined with offering / course / lecturers / slots ───

/**
 * The shape consumed by the `GET /schedule-runs/:id` serializer. Mirrors
 * api_design §5.3.8 line 991–1001; the SKS-Blocks regrouping (one entry per
 * `(offeringId, sessionIndex)`) is left to Phase 3 Task 13's serializer
 * change — this record stays flat.
 */
export interface ScheduleRunAssignmentDetail {
  id: number;
  offeringId: number;
  sessionIndex: number;
  roomId: number;
  isFixedRoom: boolean;
  manualOverride: boolean;
  slots: Array<{
    id: number;
    day: string;
    startTime: string;
    endTime: string;
  }>;
  offering: {
    id: number;
    courseCode: string;
    courseName: string;
    lecturers: Array<{ id: number; name: string }>;
  };
}

// ─── List options ────────────────────────────────────────────────────────

export interface ListFilter {
  status?: RunStatus;
  semesterId?: number;
  /**
   * Set by the route handler when the caller is `user`. Admins leave it
   * undefined to see every run.
   */
  createdById?: number;
}

export interface ListOptions {
  filter?: ListFilter;
  page: number;
  pageSize: number;
  sort?: string;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
}

// ─── Repository interface ────────────────────────────────────────────────

export interface AssignmentWithRun {
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
  timeSlotIds: number[];
  run: { createdById: number; status: RunStatus };
}

export interface OverrideAssignmentInput {
  roomId?: number;
  timeSlotIds?: number[];
  notes?: string;
  overriddenById: number;
}

export interface ScheduleRunRepository {
  // POST /schedule-runs (Phase 3 Task 5)
  findByIdempotencyKey(key: string): Promise<ScheduleRunRow | null>;
  countOfferingsForSemester(semesterId: number): Promise<number>;
  create(input: CreateScheduleRunInput): Promise<ScheduleRunRow>;
  markFailed(id: string, errorCode: string, errorMessage: string): Promise<void>;

  // POST /schedule-runs/:id/cancel (Phase 3 Task 8)
  cancel(id: string): Promise<void>;

  // GET / DELETE (Phase 3 Task 6)
  list(opts: ListOptions): Promise<ListResult<ScheduleRunSummaryRecord>>;
  findDetailById(id: string): Promise<ScheduleRunDetailRecord | null>;
  findAssignments(runId: string): Promise<ScheduleRunAssignmentDetail[]>;
  delete(id: string): Promise<void>;

  // DELETE /course-offerings/:id pre-flight (Phase 9 Task 1)
  countAssignmentsByOfferingId(offeringId: number): Promise<{ runIds: string[] }>;

  // PUT /schedule-runs/:id/assignments/:assignmentId (Phase 3 Task 9)
  findAssignmentById(id: number): Promise<AssignmentWithRun | null>;
  overrideAssignment(id: number, input: OverrideAssignmentInput): Promise<AssignmentWithRun>;
}

const SORTABLE = new Set([
  'createdAt',
  'completedAt',
  'startedAt',
  'bestFitness',
  'durationMs',
  'status',
]);

function parseSort(sort: string | undefined): Prisma.ScheduleRunOrderByWithRelationInput[] {
  if (!sort) return [{ createdAt: 'desc' }];
  return sort
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((token) => {
      const dir: 'asc' | 'desc' = token.startsWith('-') ? 'desc' : 'asc';
      const field = token.replace(/^[-+]/u, '');
      if (!SORTABLE.has(field)) return null;
      return { [field]: dir } as Prisma.ScheduleRunOrderByWithRelationInput;
    })
    .filter((v): v is Prisma.ScheduleRunOrderByWithRelationInput => v !== null);
}

export function createScheduleRunRepository(
  prisma: PrismaClient,
): ScheduleRunRepository {
  return {
    async findByIdempotencyKey(key) {
      return prisma.scheduleRun.findUnique({
        where: { idempotencyKey: key },
        select: SCHEDULE_RUN_SLIM_SELECT,
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
          status: 'QUEUED',
        },
        select: SCHEDULE_RUN_SLIM_SELECT,
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
    async cancel(id) {
      await prisma.scheduleRun.update({
        where: { id },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
    },
    async list({ filter, page, pageSize, sort }) {
      const where: Prisma.ScheduleRunWhereInput = {};
      if (filter?.status !== undefined) where.status = filter.status;
      if (filter?.semesterId !== undefined) where.semesterId = filter.semesterId;
      if (filter?.createdById !== undefined) where.createdById = filter.createdById;

      const orderBy = parseSort(sort);
      const [rows, total] = await Promise.all([
        prisma.scheduleRun.findMany({
          where,
          orderBy: orderBy.length > 0 ? orderBy : [{ createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: SCHEDULE_RUN_SUMMARY_SELECT,
        }),
        prisma.scheduleRun.count({ where }),
      ]);
      return { rows, total };
    },
    async findDetailById(id) {
      return prisma.scheduleRun.findUnique({
        where: { id },
        select: SCHEDULE_RUN_DETAIL_SELECT,
      });
    },
    async findAssignments(runId) {
      const rows = await prisma.scheduleAssignment.findMany({
        where: { runId },
        orderBy: [{ offeringId: 'asc' }, { sessionIndex: 'asc' }],
        include: {
          slots: {
            include: {
              timeSlot: {
                select: { id: true, day: true, startTime: true, endTime: true },
              },
            },
          },
          offering: {
            select: {
              id: true,
              course: { select: { code: true, name: true } },
              lecturers: {
                select: {
                  lecturer: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      });

      return rows.map((r) => ({
        id: r.id,
        offeringId: r.offeringId,
        sessionIndex: r.sessionIndex,
        roomId: r.roomId,
        isFixedRoom: r.isFixedRoom,
        manualOverride: r.manualOverride,
        slots: r.slots.map((s) => ({
          id: s.timeSlot.id,
          day: s.timeSlot.day,
          startTime: s.timeSlot.startTime,
          endTime: s.timeSlot.endTime,
        })),
        offering: {
          id: r.offering.id,
          courseCode: r.offering.course.code,
          courseName: r.offering.course.name,
          lecturers: r.offering.lecturers.map((l) => ({
            id: l.lecturer.id,
            name: l.lecturer.name,
          })),
        },
      }));
    },
    async delete(id) {
      await prisma.scheduleRun.delete({ where: { id } });
    },
    async countAssignmentsByOfferingId(offeringId) {
      const rows = await prisma.scheduleAssignment.findMany({
        where: { offeringId },
        select: { runId: true },
        distinct: ['runId'],
      });
      return { runIds: rows.map((r) => r.runId) };
    },
    async findAssignmentById(id) {
      const row = await prisma.scheduleAssignment.findUnique({
        where: { id },
        include: {
          slots: { select: { timeSlotId: true } },
          run: { select: { createdById: true, status: true } },
        },
      });
      if (!row) return null;
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
        run: { createdById: row.run.createdById, status: row.run.status },
      };
    },
    async overrideAssignment(id, input) {
      const now = new Date();
      const result = await prisma.$transaction(async (tx) => {
        const data: Record<string, unknown> = {
          manualOverride: true,
          overriddenById: input.overriddenById,
          overriddenAt: now,
        };
        if (input.roomId !== undefined) data.roomId = input.roomId;
        if (input.notes !== undefined) data.notes = input.notes;

        const updated = await tx.scheduleAssignment.update({
          where: { id },
          data,
          include: {
            slots: { select: { timeSlotId: true } },
            run: { select: { createdById: true, status: true } },
          },
        });

        if (input.timeSlotIds !== undefined) {
          await tx.scheduleAssignmentSlot.deleteMany({
            where: { assignmentId: id },
          });
          await tx.scheduleAssignmentSlot.createMany({
            data: input.timeSlotIds.map((timeSlotId) => ({
              assignmentId: id,
              timeSlotId,
            })),
          });
        }

        const finalSlots = input.timeSlotIds
          ? input.timeSlotIds.map((timeSlotId) => ({ timeSlotId }))
          : updated.slots;

        return {
          ...updated,
          slots: finalSlots,
        };
      });

      return {
        id: result.id,
        runId: result.runId,
        offeringId: result.offeringId,
        sessionIndex: result.sessionIndex,
        roomId: result.roomId,
        isFixedRoom: result.isFixedRoom,
        manualOverride: result.manualOverride,
        overriddenById: result.overriddenById,
        overriddenAt: result.overriddenAt,
        notes: result.notes,
        timeSlotIds: result.slots.map((s) => s.timeSlotId),
        run: { createdById: result.run.createdById, status: result.run.status },
      };
    },
  };
}
