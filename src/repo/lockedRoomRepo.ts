/**
 * Thin repository facade around `prisma.lockedRoom` for the `/locked-rooms`
 * CRUD routes (api_design §5.3.3 — note: route falls under §5.3.4 by topic
 * but the special body shape lives in §5.3.4 paragraph on locked-rooms).
 *
 * `LockedRoom.offeringId` is `@unique` in the schema (one offering ↔ one
 * lock), so a duplicate POST raises `P2002` which the route translates to
 * 409.
 */

import type { PrismaClient, Prisma, LockedRoom } from '@prisma/client';

export type LockedRoomRecord = Pick<
  LockedRoom,
  'id' | 'semesterId' | 'offeringId' | 'roomId' | 'lockedById' | 'lockedAt' | 'reason'
>;

export interface CreateLockedRoomInput {
  semesterId: number;
  offeringId: number;
  roomId: number;
  lockedById: number;
  reason?: string | null;
}

export interface UpdateLockedRoomInput {
  roomId?: number;
  reason?: string | null;
}

export interface ListLockedRoomsOptions {
  filter?: { semesterId?: number; offeringId?: number; roomId?: number };
  page: number;
  pageSize: number;
  sort?: string;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
}

export interface LockedRoomRepository {
  list(opts: ListLockedRoomsOptions): Promise<ListResult<LockedRoomRecord>>;
  findById(id: number): Promise<LockedRoomRecord | null>;
  create(input: CreateLockedRoomInput): Promise<LockedRoomRecord>;
  update(id: number, patch: UpdateLockedRoomInput): Promise<LockedRoomRecord>;
  delete(id: number): Promise<void>;
  /**
   * Returns true if any `ScheduleRun` for `semesterId` is currently `RUNNING`.
   * Used by the route layer to enforce the api_design §5.3.4 rule that
   * locked rooms cannot be created or modified while a run is in flight.
   */
  hasRunningScheduleRunForSemester(semesterId: number): Promise<boolean>;
}

const LOCKED_ROOM_SELECT = {
  id: true,
  semesterId: true,
  offeringId: true,
  roomId: true,
  lockedById: true,
  lockedAt: true,
  reason: true,
} as const;

const SORTABLE = new Set(['lockedAt', 'id']);

function parseSort(sort: string | undefined): Prisma.LockedRoomOrderByWithRelationInput[] {
  if (!sort) return [{ lockedAt: 'desc' }];
  return sort
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((token) => {
      const dir: 'asc' | 'desc' = token.startsWith('-') ? 'desc' : 'asc';
      const field = token.replace(/^[-+]/u, '');
      if (!SORTABLE.has(field)) return null;
      return { [field]: dir } as Prisma.LockedRoomOrderByWithRelationInput;
    })
    .filter((v): v is Prisma.LockedRoomOrderByWithRelationInput => v !== null);
}

export function createLockedRoomRepository(prisma: PrismaClient): LockedRoomRepository {
  return {
    async list({ filter, page, pageSize, sort }) {
      const where: Prisma.LockedRoomWhereInput = {};
      if (filter?.semesterId !== undefined) where.semesterId = filter.semesterId;
      if (filter?.offeringId !== undefined) where.offeringId = filter.offeringId;
      if (filter?.roomId !== undefined) where.roomId = filter.roomId;
      const orderBy = parseSort(sort);
      const [rows, total] = await Promise.all([
        prisma.lockedRoom.findMany({
          where,
          orderBy: orderBy.length > 0 ? orderBy : [{ lockedAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: LOCKED_ROOM_SELECT,
        }),
        prisma.lockedRoom.count({ where }),
      ]);
      return { rows, total };
    },
    async findById(id) {
      return prisma.lockedRoom.findUnique({ where: { id }, select: LOCKED_ROOM_SELECT });
    },
    async create(input) {
      return prisma.lockedRoom.create({
        data: {
          semesterId: input.semesterId,
          offeringId: input.offeringId,
          roomId: input.roomId,
          lockedById: input.lockedById,
          reason: input.reason ?? null,
        },
        select: LOCKED_ROOM_SELECT,
      });
    },
    async update(id, patch) {
      const data: Prisma.LockedRoomUpdateInput = {};
      if (patch.roomId !== undefined) data.room = { connect: { id: patch.roomId } };
      if (patch.reason !== undefined) data.reason = patch.reason;
      return prisma.lockedRoom.update({
        where: { id },
        data,
        select: LOCKED_ROOM_SELECT,
      });
    },
    async delete(id) {
      await prisma.lockedRoom.delete({ where: { id } });
    },
    async hasRunningScheduleRunForSemester(semesterId) {
      const count = await prisma.scheduleRun.count({
        where: { semesterId, status: 'RUNNING' },
      });
      return count > 0;
    },
  };
}
