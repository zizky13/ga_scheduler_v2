/**
 * Thin repository facade around `prisma.lecturer` for the `/lecturers` CRUD
 * routes (api_design §5.3.5). Mirrors the conventions of `roomRepo.ts`.
 *
 * `preferredTimeSlotIds` arrives as a `number[]`; the repo resolves them via
 * the `LecturerPreferredSlot` join table. `competencies` rides the native
 * Postgres `String[]` column directly (the SQLite fallback in
 * `competencyCodec.ts` handles JSON encoding for that target).
 *
 * `createdById` (audit) is filled from the calling user; routes pass it in
 * explicitly so the repo never reads `req`.
 */

import type { PrismaClient, Prisma, Lecturer } from '@prisma/client';

export interface LecturerRecord {
  id: number;
  semesterId: number;
  name: string;
  isStructural: boolean;
  maxSks: number;
  preferredTimeSlotIds: number[];
  competencies: string[];
  createdById: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLecturerInput {
  semesterId: number;
  name: string;
  isStructural: boolean;
  maxSks?: number;
  preferredTimeSlotIds: number[];
  competencies: string[];
  createdById: number | null;
}

export interface UpdateLecturerInput {
  name?: string;
  isStructural?: boolean;
  maxSks?: number;
  preferredTimeSlotIds?: number[];
  competencies?: string[];
}

export interface ListLecturersOptions {
  filter?: { semesterId?: number; isStructural?: boolean };
  page: number;
  pageSize: number;
  sort?: string;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
}

export interface LecturerRepository {
  list(opts: ListLecturersOptions): Promise<ListResult<LecturerRecord>>;
  findById(id: number): Promise<LecturerRecord | null>;
  create(input: CreateLecturerInput): Promise<LecturerRecord>;
  update(id: number, patch: UpdateLecturerInput): Promise<LecturerRecord>;
  delete(id: number): Promise<void>;
  /**
   * Returns true if any `CourseOfferingLecturer` row references this lecturer
   * — used by the route layer to surface a 409 instead of letting onDelete:
   * Restrict raise an opaque P2003 (api_design §5.3.5).
   */
  hasOfferingReferences(id: number): Promise<boolean>;
}

const LECTURER_INCLUDE = {
  preferredSlots: { select: { timeSlotId: true } },
} as const;

const SORTABLE = new Set(['createdAt', 'name']);

function parseSort(sort: string | undefined): Prisma.LecturerOrderByWithRelationInput[] {
  if (!sort) return [{ createdAt: 'desc' }];
  return sort
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((token) => {
      const dir: 'asc' | 'desc' = token.startsWith('-') ? 'desc' : 'asc';
      const field = token.replace(/^[-+]/u, '');
      if (!SORTABLE.has(field)) return null;
      return { [field]: dir } as Prisma.LecturerOrderByWithRelationInput;
    })
    .filter((v): v is Prisma.LecturerOrderByWithRelationInput => v !== null);
}

type LecturerWithSlots = Lecturer & {
  preferredSlots: { timeSlotId: number }[];
};

function toRecord(row: LecturerWithSlots): LecturerRecord {
  return {
    id: row.id,
    semesterId: row.semesterId,
    name: row.name,
    isStructural: row.isStructural,
    maxSks: row.maxSks,
    preferredTimeSlotIds: row.preferredSlots.map((p) => p.timeSlotId),
    competencies: [...row.competencies],
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createLecturerRepository(prisma: PrismaClient): LecturerRepository {
  return {
    async list({ filter, page, pageSize, sort }) {
      const where: Prisma.LecturerWhereInput = {};
      if (filter?.semesterId !== undefined) where.semesterId = filter.semesterId;
      if (filter?.isStructural !== undefined) where.isStructural = filter.isStructural;
      const orderBy = parseSort(sort);
      const [rows, total] = await Promise.all([
        prisma.lecturer.findMany({
          where,
          orderBy: orderBy.length > 0 ? orderBy : [{ createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: LECTURER_INCLUDE,
        }),
        prisma.lecturer.count({ where }),
      ]);
      return { rows: rows.map(toRecord), total };
    },
    async findById(id) {
      const row = await prisma.lecturer.findUnique({
        where: { id },
        include: LECTURER_INCLUDE,
      });
      return row ? toRecord(row) : null;
    },
    async create(input) {
      const created = await prisma.lecturer.create({
        data: {
          semesterId: input.semesterId,
          name: input.name,
          isStructural: input.isStructural,
          maxSks: input.maxSks ?? (input.isStructural ? 6 : 12),
          competencies: input.competencies,
          createdById: input.createdById,
          preferredSlots: {
            create: input.preferredTimeSlotIds.map((timeSlotId) => ({ timeSlotId })),
          },
        },
        include: LECTURER_INCLUDE,
      });
      return toRecord(created);
    },
    async update(id, patch) {
      const updated = await prisma.$transaction(async (tx) => {
        if (patch.preferredTimeSlotIds !== undefined) {
          await tx.lecturerPreferredSlot.deleteMany({ where: { lecturerId: id } });
          if (patch.preferredTimeSlotIds.length > 0) {
            await tx.lecturerPreferredSlot.createMany({
              data: patch.preferredTimeSlotIds.map((timeSlotId) => ({
                lecturerId: id,
                timeSlotId,
              })),
            });
          }
        }
        const data: Prisma.LecturerUpdateInput = {};
        if (patch.name !== undefined) data.name = patch.name;
        if (patch.isStructural !== undefined) data.isStructural = patch.isStructural;
        if (patch.maxSks !== undefined) data.maxSks = patch.maxSks;
        if (patch.competencies !== undefined) data.competencies = patch.competencies;
        return tx.lecturer.update({
          where: { id },
          data,
          include: LECTURER_INCLUDE,
        });
      });
      return toRecord(updated);
    },
    async delete(id) {
      await prisma.lecturer.delete({ where: { id } });
    },
    async hasOfferingReferences(id) {
      const count = await prisma.courseOfferingLecturer.count({
        where: { lecturerId: id },
      });
      return count > 0;
    },
  };
}
