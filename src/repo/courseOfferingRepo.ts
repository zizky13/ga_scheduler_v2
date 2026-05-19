/**
 * Thin repository facade around `prisma.courseOffering` for the
 * `/course-offerings` CRUD routes (api_design §5.3.7). Mirrors `roomRepo.ts`.
 *
 * Several attributes are persisted via join tables and surfaced as plain
 * arrays on the wire:
 *   - `lecturerIds[]`       → `CourseOfferingLecturer`
 *   - `fixedTimeSlotIds[]`  → `CourseOfferingFixedSlot`
 *
 * `parentOfferingId` (parallel-split) is a self-relation; passing `null`
 * disconnects the parent.
 *
 * `isFixed` and `fixedTimeSlotIds` are admin-only at the API boundary
 * (api_design §5.3.7) — that gate lives in the route layer via
 * `allowFields(...)`. The repo accepts them unconditionally and trusts the
 * caller.
 */

import type { PrismaClient, Prisma, CourseOffering } from '@prisma/client';

export interface CourseOfferingRecord {
  id: number;
  semesterId: number;
  courseId: number;
  roomId: number | null;
  effectiveStudentCount: number;
  lecturerIds: number[];
  isFixed: boolean;
  fixedTimeSlotIds: number[];
  parentOfferingId: number | null;
  createdById: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCourseOfferingInput {
  semesterId: number;
  courseId: number;
  roomId: number | null;
  effectiveStudentCount: number;
  lecturerIds: number[];
  isFixed: boolean;
  fixedTimeSlotIds: number[];
  parentOfferingId: number | null;
  createdById: number | null;
}

export interface UpdateCourseOfferingInput {
  courseId?: number;
  roomId?: number | null;
  effectiveStudentCount?: number;
  lecturerIds?: number[];
  isFixed?: boolean;
  fixedTimeSlotIds?: number[];
  parentOfferingId?: number | null;
}

export interface ListCourseOfferingsOptions {
  filter?: {
    semesterId?: number;
    courseId?: number;
    roomId?: number;
    lecturerId?: number;
    parentOfferingId?: number;
  };
  page: number;
  pageSize: number;
  sort?: string;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
}

export interface CourseOfferingRepository {
  list(opts: ListCourseOfferingsOptions): Promise<ListResult<CourseOfferingRecord>>;
  findById(id: number): Promise<CourseOfferingRecord | null>;
  create(input: CreateCourseOfferingInput): Promise<CourseOfferingRecord>;
  update(id: number, patch: UpdateCourseOfferingInput): Promise<CourseOfferingRecord>;
  updateStudentCount(id: number, effectiveStudentCount: number): Promise<CourseOfferingRecord>;
  delete(id: number): Promise<void>;
}

const OFFERING_INCLUDE = {
  lecturers: { select: { lecturerId: true } },
  fixedSlots: { select: { timeSlotId: true } },
} as const;

const SORTABLE = new Set(['createdAt']);

function parseSort(sort: string | undefined): Prisma.CourseOfferingOrderByWithRelationInput[] {
  if (!sort) return [{ createdAt: 'desc' }];
  return sort
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((token) => {
      const dir: 'asc' | 'desc' = token.startsWith('-') ? 'desc' : 'asc';
      const field = token.replace(/^[-+]/u, '');
      if (!SORTABLE.has(field)) return null;
      return { [field]: dir } as Prisma.CourseOfferingOrderByWithRelationInput;
    })
    .filter((v): v is Prisma.CourseOfferingOrderByWithRelationInput => v !== null);
}

type OfferingWithJoins = CourseOffering & {
  lecturers: { lecturerId: number }[];
  fixedSlots: { timeSlotId: number }[];
};

function toRecord(row: OfferingWithJoins): CourseOfferingRecord {
  return {
    id: row.id,
    semesterId: row.semesterId,
    courseId: row.courseId,
    roomId: row.roomId,
    effectiveStudentCount: row.effectiveStudentCount,
    lecturerIds: row.lecturers.map((l) => l.lecturerId),
    isFixed: row.isFixed,
    fixedTimeSlotIds: row.fixedSlots.map((s) => s.timeSlotId),
    parentOfferingId: row.parentOfferingId,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createCourseOfferingRepository(
  prisma: PrismaClient,
): CourseOfferingRepository {
  return {
    async list({ filter, page, pageSize, sort }) {
      const where: Prisma.CourseOfferingWhereInput = {};
      if (filter?.semesterId !== undefined) where.semesterId = filter.semesterId;
      if (filter?.courseId !== undefined) where.courseId = filter.courseId;
      if (filter?.roomId !== undefined) where.roomId = filter.roomId;
      if (filter?.parentOfferingId !== undefined) {
        where.parentOfferingId = filter.parentOfferingId;
      }
      if (filter?.lecturerId !== undefined) {
        where.lecturers = { some: { lecturerId: filter.lecturerId } };
      }
      const orderBy = parseSort(sort);
      const [rows, total] = await Promise.all([
        prisma.courseOffering.findMany({
          where,
          orderBy: orderBy.length > 0 ? orderBy : [{ createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: OFFERING_INCLUDE,
        }),
        prisma.courseOffering.count({ where }),
      ]);
      return { rows: rows.map(toRecord), total };
    },
    async findById(id) {
      const row = await prisma.courseOffering.findUnique({
        where: { id },
        include: OFFERING_INCLUDE,
      });
      return row ? toRecord(row) : null;
    },
    async create(input) {
      const created = await prisma.courseOffering.create({
        data: {
          semesterId: input.semesterId,
          courseId: input.courseId,
          roomId: input.roomId,
          effectiveStudentCount: input.effectiveStudentCount,
          isFixed: input.isFixed,
          parentOfferingId: input.parentOfferingId,
          createdById: input.createdById,
          lecturers: {
            create: input.lecturerIds.map((lecturerId) => ({ lecturerId })),
          },
          fixedSlots: {
            create: input.fixedTimeSlotIds.map((timeSlotId) => ({ timeSlotId })),
          },
        },
        include: OFFERING_INCLUDE,
      });
      return toRecord(created);
    },
    async update(id, patch) {
      const updated = await prisma.$transaction(async (tx) => {
        if (patch.lecturerIds !== undefined) {
          await tx.courseOfferingLecturer.deleteMany({ where: { offeringId: id } });
          if (patch.lecturerIds.length > 0) {
            await tx.courseOfferingLecturer.createMany({
              data: patch.lecturerIds.map((lecturerId) => ({
                offeringId: id,
                lecturerId,
              })),
            });
          }
        }
        if (patch.fixedTimeSlotIds !== undefined) {
          await tx.courseOfferingFixedSlot.deleteMany({ where: { offeringId: id } });
          if (patch.fixedTimeSlotIds.length > 0) {
            await tx.courseOfferingFixedSlot.createMany({
              data: patch.fixedTimeSlotIds.map((timeSlotId) => ({
                offeringId: id,
                timeSlotId,
              })),
            });
          }
        }
        const data: Prisma.CourseOfferingUpdateInput = {};
        if (patch.courseId !== undefined) {
          data.course = { connect: { id: patch.courseId } };
        }
        if (patch.roomId !== undefined) {
          data.room =
            patch.roomId === null
              ? { disconnect: true }
              : { connect: { id: patch.roomId } };
        }
        if (patch.effectiveStudentCount !== undefined) {
          data.effectiveStudentCount = patch.effectiveStudentCount;
        }
        if (patch.isFixed !== undefined) data.isFixed = patch.isFixed;
        if (patch.parentOfferingId !== undefined) {
          data.parent =
            patch.parentOfferingId === null
              ? { disconnect: true }
              : { connect: { id: patch.parentOfferingId } };
        }
        return tx.courseOffering.update({
          where: { id },
          data,
          include: OFFERING_INCLUDE,
        });
      });
      return toRecord(updated);
    },
    async updateStudentCount(id, effectiveStudentCount) {
      const updated = await prisma.courseOffering.update({
        where: { id },
        data: { effectiveStudentCount },
        include: OFFERING_INCLUDE,
      });
      return toRecord(updated);
    },
    async delete(id) {
      await prisma.courseOffering.delete({ where: { id } });
    },
  };
}
