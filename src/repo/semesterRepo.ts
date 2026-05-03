/**
 * Thin repository facade around `prisma.semester` for the `/semesters` CRUD
 * routes (api_design §5.3.3).
 *
 * Mirrors the conventions of `userRepo.ts` / `refreshTokenRepo.ts`: a `select`
 * clause keeps the wire shape stable across Prisma upgrades, and the factory
 * accepts a `PrismaClient` so the route layer can inject test fakes.
 */

import type { PrismaClient, Prisma, Semester } from '@prisma/client';

export type SemesterRecord = Pick<
  Semester,
  'id' | 'code' | 'label' | 'startsOn' | 'endsOn' | 'isActive' | 'createdAt' | 'updatedAt'
>;

export interface CreateSemesterInput {
  code: string;
  label: string;
  startsOn: Date;
  endsOn: Date;
}

export interface UpdateSemesterInput {
  label?: string;
  startsOn?: Date;
  endsOn?: Date;
}

export interface ListSemestersFilter {
  isActive?: boolean;
}

export interface ListSemestersOptions {
  filter?: ListSemestersFilter;
  page: number;
  pageSize: number;
  sort?: string;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
}

export interface SemesterRepository {
  list(opts: ListSemestersOptions): Promise<ListResult<SemesterRecord>>;
  findById(id: number): Promise<SemesterRecord | null>;
  create(input: CreateSemesterInput): Promise<SemesterRecord>;
  update(id: number, patch: UpdateSemesterInput): Promise<SemesterRecord>;
  activate(id: number): Promise<SemesterRecord>;
  delete(id: number): Promise<void>;
  hasRelatedRows(id: number): Promise<boolean>;
}

const SEMESTER_SELECT = {
  id: true,
  code: true,
  label: true,
  startsOn: true,
  endsOn: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SORTABLE = new Set(['createdAt', 'startsOn', 'endsOn', 'code']);

function parseSort(sort: string | undefined): Prisma.SemesterOrderByWithRelationInput[] {
  if (!sort) return [{ createdAt: 'desc' }];
  return sort
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((token) => {
      const dir: 'asc' | 'desc' = token.startsWith('-') ? 'desc' : 'asc';
      const field = token.replace(/^[-+]/u, '');
      if (!SORTABLE.has(field)) return null;
      return { [field]: dir } as Prisma.SemesterOrderByWithRelationInput;
    })
    .filter((v): v is Prisma.SemesterOrderByWithRelationInput => v !== null);
}

export function createSemesterRepository(prisma: PrismaClient): SemesterRepository {
  return {
    async list({ filter, page, pageSize, sort }) {
      const where: Prisma.SemesterWhereInput = {};
      if (filter?.isActive !== undefined) where.isActive = filter.isActive;
      const orderBy = parseSort(sort);
      const [rows, total] = await Promise.all([
        prisma.semester.findMany({
          where,
          orderBy: orderBy.length > 0 ? orderBy : [{ createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: SEMESTER_SELECT,
        }),
        prisma.semester.count({ where }),
      ]);
      return { rows, total };
    },
    async findById(id) {
      return prisma.semester.findUnique({ where: { id }, select: SEMESTER_SELECT });
    },
    async create(input) {
      return prisma.semester.create({
        data: {
          code: input.code,
          label: input.label,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
        },
        select: SEMESTER_SELECT,
      });
    },
    async update(id, patch) {
      return prisma.semester.update({
        where: { id },
        data: patch,
        select: SEMESTER_SELECT,
      });
    },
    async activate(id) {
      // Atomically: clear isActive on every row, then set it on the target.
      // Wrapped in a transaction so a partial failure can't leave zero or
      // multiple rows active (api_design §5.3.3).
      const [, target] = await prisma.$transaction([
        prisma.semester.updateMany({
          where: { isActive: true, NOT: { id } },
          data: { isActive: false },
        }),
        prisma.semester.update({
          where: { id },
          data: { isActive: true },
          select: SEMESTER_SELECT,
        }),
      ]);
      return target;
    },
    async delete(id) {
      await prisma.semester.delete({ where: { id } });
    },
    async hasRelatedRows(id) {
      // 409 if any related rows exist (api_design §5.3.3 DELETE).
      const counts = await Promise.all([
        prisma.room.count({ where: { semesterId: id } }),
        prisma.timeSlot.count({ where: { semesterId: id } }),
        prisma.lecturer.count({ where: { semesterId: id } }),
        prisma.course.count({ where: { semesterId: id } }),
        prisma.courseOffering.count({ where: { semesterId: id } }),
        prisma.lockedRoom.count({ where: { semesterId: id } }),
        prisma.scheduleRun.count({ where: { semesterId: id } }),
      ]);
      return counts.some((c) => c > 0);
    },
  };
}
