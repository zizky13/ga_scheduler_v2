/**
 * Thin repository facade around `prisma.facility` for the `/facilities` CRUD
 * routes (api_design §5.3.4).
 */

import type { PrismaClient, Prisma, Facility } from '@prisma/client';

export type FacilityRecord = Pick<Facility, 'id' | 'code' | 'label'>;

export interface CreateFacilityInput {
  code: string;
  label: string;
}

export interface UpdateFacilityInput {
  code?: string;
  label?: string;
}

export interface ListFacilitiesOptions {
  page: number;
  pageSize: number;
  sort?: string;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
}

export interface FacilityRepository {
  list(opts: ListFacilitiesOptions): Promise<ListResult<FacilityRecord>>;
  findById(id: number): Promise<FacilityRecord | null>;
  create(input: CreateFacilityInput): Promise<FacilityRecord>;
  update(id: number, patch: UpdateFacilityInput): Promise<FacilityRecord>;
  delete(id: number): Promise<void>;
}

const FACILITY_SELECT = { id: true, code: true, label: true } as const;

const SORTABLE = new Set(['code', 'label']);

function parseSort(sort: string | undefined): Prisma.FacilityOrderByWithRelationInput[] {
  if (!sort) return [{ code: 'asc' }];
  return sort
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((token) => {
      const dir: 'asc' | 'desc' = token.startsWith('-') ? 'desc' : 'asc';
      const field = token.replace(/^[-+]/u, '');
      if (!SORTABLE.has(field)) return null;
      return { [field]: dir } as Prisma.FacilityOrderByWithRelationInput;
    })
    .filter((v): v is Prisma.FacilityOrderByWithRelationInput => v !== null);
}

export function createFacilityRepository(prisma: PrismaClient): FacilityRepository {
  return {
    async list({ page, pageSize, sort }) {
      const orderBy = parseSort(sort);
      const [rows, total] = await Promise.all([
        prisma.facility.findMany({
          orderBy: orderBy.length > 0 ? orderBy : [{ code: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: FACILITY_SELECT,
        }),
        prisma.facility.count(),
      ]);
      return { rows, total };
    },
    async findById(id) {
      return prisma.facility.findUnique({ where: { id }, select: FACILITY_SELECT });
    },
    async create(input) {
      return prisma.facility.create({ data: input, select: FACILITY_SELECT });
    },
    async update(id, patch) {
      return prisma.facility.update({
        where: { id },
        data: patch,
        select: FACILITY_SELECT,
      });
    },
    async delete(id) {
      await prisma.facility.delete({ where: { id } });
    },
  };
}
