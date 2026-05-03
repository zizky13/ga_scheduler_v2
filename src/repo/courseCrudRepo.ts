/**
 * Thin repository facade around `prisma.course` for the `/courses` CRUD
 * routes (api_design §5.3.6). Mirrors `roomRepo.ts`.
 *
 * `requiredFacilities` arrives as a `string[]` of `Facility.code` values.
 * Unknown codes raise `UnknownFacilityCodeError` (re-exported from
 * `roomRepo.ts`) so the route can return 400 instead of letting Prisma throw
 * an opaque foreign-key error.
 *
 * `requiredCompetencies` rides the native Postgres `String[]` column directly.
 *
 * `(semesterId, code)` is `@@unique` in the schema → `P2002` becomes 409
 * `COURSE_CODE_TAKEN`.
 */

import type { PrismaClient, Prisma, Course } from '@prisma/client';

import { UnknownFacilityCodeError } from './roomRepo';

export interface CourseRecord {
  id: number;
  semesterId: number;
  code: string;
  name: string;
  sks: number;
  requiredFacilities: string[];
  requiredCompetencies: string[];
  createdById: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCourseInput {
  semesterId: number;
  code: string;
  name: string;
  sks: number;
  requiredFacilities: string[];
  requiredCompetencies: string[];
  createdById: number | null;
}

export interface UpdateCourseInput {
  code?: string;
  name?: string;
  sks?: number;
  requiredFacilities?: string[];
  requiredCompetencies?: string[];
}

export interface ListCoursesOptions {
  filter?: { semesterId?: number };
  page: number;
  pageSize: number;
  sort?: string;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
}

export interface CourseRepository {
  list(opts: ListCoursesOptions): Promise<ListResult<CourseRecord>>;
  findById(id: number): Promise<CourseRecord | null>;
  create(input: CreateCourseInput): Promise<CourseRecord>;
  update(id: number, patch: UpdateCourseInput): Promise<CourseRecord>;
  delete(id: number): Promise<void>;
  /**
   * Returns true if any `CourseOffering` references this course — surfaces a
   * 409 on DELETE rather than the opaque P2003 onDelete: Restrict.
   */
  hasOfferingReferences(id: number): Promise<boolean>;
}

const COURSE_INCLUDE = {
  requiredFacilities: { include: { facility: { select: { code: true } } } },
} as const;

const SORTABLE = new Set(['createdAt', 'code', 'name', 'sks']);

function parseSort(sort: string | undefined): Prisma.CourseOrderByWithRelationInput[] {
  if (!sort) return [{ createdAt: 'desc' }];
  return sort
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((token) => {
      const dir: 'asc' | 'desc' = token.startsWith('-') ? 'desc' : 'asc';
      const field = token.replace(/^[-+]/u, '');
      if (!SORTABLE.has(field)) return null;
      return { [field]: dir } as Prisma.CourseOrderByWithRelationInput;
    })
    .filter((v): v is Prisma.CourseOrderByWithRelationInput => v !== null);
}

type CourseWithFacilities = Course & {
  requiredFacilities: { facility: { code: string } }[];
};

function toRecord(row: CourseWithFacilities): CourseRecord {
  return {
    id: row.id,
    semesterId: row.semesterId,
    code: row.code,
    name: row.name,
    sks: row.sks,
    requiredFacilities: row.requiredFacilities.map((rf) => rf.facility.code),
    requiredCompetencies: [...row.requiredCompetencies],
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function resolveFacilityIds(
  prisma: PrismaClient,
  codes: string[],
): Promise<{ facilityId: number }[]> {
  if (codes.length === 0) return [];
  const rows = await prisma.facility.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const found = new Set(rows.map((r) => r.code));
  const missing = codes.filter((c) => !found.has(c));
  if (missing.length > 0) throw new UnknownFacilityCodeError(missing);
  return rows.map((r) => ({ facilityId: r.id }));
}

export function createCourseRepository(prisma: PrismaClient): CourseRepository {
  return {
    async list({ filter, page, pageSize, sort }) {
      const where: Prisma.CourseWhereInput = {};
      if (filter?.semesterId !== undefined) where.semesterId = filter.semesterId;
      const orderBy = parseSort(sort);
      const [rows, total] = await Promise.all([
        prisma.course.findMany({
          where,
          orderBy: orderBy.length > 0 ? orderBy : [{ createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: COURSE_INCLUDE,
        }),
        prisma.course.count({ where }),
      ]);
      return { rows: rows.map(toRecord), total };
    },
    async findById(id) {
      const row = await prisma.course.findUnique({
        where: { id },
        include: COURSE_INCLUDE,
      });
      return row ? toRecord(row) : null;
    },
    async create(input) {
      const facilityRows = await resolveFacilityIds(prisma, input.requiredFacilities);
      const created = await prisma.course.create({
        data: {
          semesterId: input.semesterId,
          code: input.code,
          name: input.name,
          sks: input.sks,
          requiredCompetencies: input.requiredCompetencies,
          createdById: input.createdById,
          requiredFacilities: { create: facilityRows },
        },
        include: COURSE_INCLUDE,
      });
      return toRecord(created);
    },
    async update(id, patch) {
      const updated = await prisma.$transaction(async (tx) => {
        if (patch.requiredFacilities !== undefined) {
          const facilityRows = await resolveFacilityIds(prisma, patch.requiredFacilities);
          await tx.courseRequiredFacility.deleteMany({ where: { courseId: id } });
          if (facilityRows.length > 0) {
            await tx.courseRequiredFacility.createMany({
              data: facilityRows.map((f) => ({
                courseId: id,
                facilityId: f.facilityId,
              })),
            });
          }
        }
        const data: Prisma.CourseUpdateInput = {};
        if (patch.code !== undefined) data.code = patch.code;
        if (patch.name !== undefined) data.name = patch.name;
        if (patch.sks !== undefined) data.sks = patch.sks;
        if (patch.requiredCompetencies !== undefined) {
          data.requiredCompetencies = patch.requiredCompetencies;
        }
        return tx.course.update({
          where: { id },
          data,
          include: COURSE_INCLUDE,
        });
      });
      return toRecord(updated);
    },
    async delete(id) {
      await prisma.course.delete({ where: { id } });
    },
    async hasOfferingReferences(id) {
      const count = await prisma.courseOffering.count({ where: { courseId: id } });
      return count > 0;
    },
  };
}
