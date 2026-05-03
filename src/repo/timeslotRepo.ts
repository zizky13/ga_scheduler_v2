/**
 * Thin repository facade around `prisma.timeSlot` for the `/timeslots` CRUD
 * routes (api_design §5.3.4).
 */

import type { PrismaClient, Prisma, TimeSlot, Weekday } from '@prisma/client';

export type TimeSlotRecord = Pick<
  TimeSlot,
  'id' | 'semesterId' | 'day' | 'startTime' | 'endTime'
>;

export interface CreateTimeSlotInput {
  semesterId: number;
  day: Weekday;
  startTime: string;
  endTime: string;
}

export interface UpdateTimeSlotInput {
  day?: Weekday;
  startTime?: string;
  endTime?: string;
}

export interface ListTimeSlotsOptions {
  filter?: { semesterId?: number; day?: Weekday };
  page: number;
  pageSize: number;
  sort?: string;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
}

export interface TimeSlotRepository {
  list(opts: ListTimeSlotsOptions): Promise<ListResult<TimeSlotRecord>>;
  findById(id: number): Promise<TimeSlotRecord | null>;
  create(input: CreateTimeSlotInput): Promise<TimeSlotRecord>;
  update(id: number, patch: UpdateTimeSlotInput): Promise<TimeSlotRecord>;
  delete(id: number): Promise<void>;
}

const TIMESLOT_SELECT = {
  id: true,
  semesterId: true,
  day: true,
  startTime: true,
  endTime: true,
} as const;

const SORTABLE = new Set(['day', 'startTime']);

function parseSort(sort: string | undefined): Prisma.TimeSlotOrderByWithRelationInput[] {
  if (!sort) return [{ day: 'asc' }, { startTime: 'asc' }];
  return sort
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((token) => {
      const dir: 'asc' | 'desc' = token.startsWith('-') ? 'desc' : 'asc';
      const field = token.replace(/^[-+]/u, '');
      if (!SORTABLE.has(field)) return null;
      return { [field]: dir } as Prisma.TimeSlotOrderByWithRelationInput;
    })
    .filter((v): v is Prisma.TimeSlotOrderByWithRelationInput => v !== null);
}

export function createTimeSlotRepository(prisma: PrismaClient): TimeSlotRepository {
  return {
    async list({ filter, page, pageSize, sort }) {
      const where: Prisma.TimeSlotWhereInput = {};
      if (filter?.semesterId !== undefined) where.semesterId = filter.semesterId;
      if (filter?.day !== undefined) where.day = filter.day;
      const orderBy = parseSort(sort);
      const [rows, total] = await Promise.all([
        prisma.timeSlot.findMany({
          where,
          orderBy: orderBy.length > 0 ? orderBy : [{ day: 'asc' }, { startTime: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: TIMESLOT_SELECT,
        }),
        prisma.timeSlot.count({ where }),
      ]);
      return { rows, total };
    },
    async findById(id) {
      return prisma.timeSlot.findUnique({ where: { id }, select: TIMESLOT_SELECT });
    },
    async create(input) {
      return prisma.timeSlot.create({
        data: input,
        select: TIMESLOT_SELECT,
      });
    },
    async update(id, patch) {
      return prisma.timeSlot.update({
        where: { id },
        data: patch,
        select: TIMESLOT_SELECT,
      });
    },
    async delete(id) {
      await prisma.timeSlot.delete({ where: { id } });
    },
  };
}
