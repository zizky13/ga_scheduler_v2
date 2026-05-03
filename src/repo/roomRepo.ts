/**
 * Thin repository facade around `prisma.room` for the `/rooms` CRUD routes
 * (api_design §5.3.4). Mirrors the conventions of `userRepo.ts`.
 *
 * `facilities` arrives at the boundary as a `string[]` of `Facility.code`
 * values. The repo resolves each code to a `Facility.id` via the join table —
 * unknown codes raise `UNKNOWN_FACILITY` so the route can return 400 instead
 * of letting Prisma throw an opaque foreign-key error.
 */

import type { PrismaClient, Prisma, Room } from '@prisma/client';

export interface RoomRecord {
  id: number;
  semesterId: number;
  name: string;
  capacity: number;
  facilities: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRoomInput {
  semesterId: number;
  name: string;
  capacity: number;
  facilities: string[];
}

export interface UpdateRoomInput {
  name?: string;
  capacity?: number;
  facilities?: string[];
}

export interface ListRoomsOptions {
  filter?: { semesterId?: number };
  page: number;
  pageSize: number;
  sort?: string;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
}

export class UnknownFacilityCodeError extends Error {
  public readonly codes: string[];
  constructor(codes: string[]) {
    super(`Unknown facility codes: ${codes.join(', ')}`);
    this.name = 'UnknownFacilityCodeError';
    this.codes = codes;
  }
}

export interface RoomRepository {
  list(opts: ListRoomsOptions): Promise<ListResult<RoomRecord>>;
  findById(id: number): Promise<RoomRecord | null>;
  create(input: CreateRoomInput): Promise<RoomRecord>;
  update(id: number, patch: UpdateRoomInput): Promise<RoomRecord>;
  delete(id: number): Promise<void>;
}

const ROOM_INCLUDE = {
  facilities: { include: { facility: { select: { code: true } } } },
} as const;

const SORTABLE = new Set(['createdAt', 'name', 'capacity']);

function parseSort(sort: string | undefined): Prisma.RoomOrderByWithRelationInput[] {
  if (!sort) return [{ createdAt: 'desc' }];
  return sort
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((token) => {
      const dir: 'asc' | 'desc' = token.startsWith('-') ? 'desc' : 'asc';
      const field = token.replace(/^[-+]/u, '');
      if (!SORTABLE.has(field)) return null;
      return { [field]: dir } as Prisma.RoomOrderByWithRelationInput;
    })
    .filter((v): v is Prisma.RoomOrderByWithRelationInput => v !== null);
}

type RoomWithFacilities = Room & {
  facilities: { facility: { code: string } }[];
};

function toRecord(row: RoomWithFacilities): RoomRecord {
  return {
    id: row.id,
    semesterId: row.semesterId,
    name: row.name,
    capacity: row.capacity,
    facilities: row.facilities.map((rf) => rf.facility.code),
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

export function createRoomRepository(prisma: PrismaClient): RoomRepository {
  return {
    async list({ filter, page, pageSize, sort }) {
      const where: Prisma.RoomWhereInput = {};
      if (filter?.semesterId !== undefined) where.semesterId = filter.semesterId;
      const orderBy = parseSort(sort);
      const [rows, total] = await Promise.all([
        prisma.room.findMany({
          where,
          orderBy: orderBy.length > 0 ? orderBy : [{ createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: ROOM_INCLUDE,
        }),
        prisma.room.count({ where }),
      ]);
      return { rows: rows.map(toRecord), total };
    },
    async findById(id) {
      const row = await prisma.room.findUnique({ where: { id }, include: ROOM_INCLUDE });
      return row ? toRecord(row) : null;
    },
    async create(input) {
      const facilityRows = await resolveFacilityIds(prisma, input.facilities);
      const created = await prisma.room.create({
        data: {
          semesterId: input.semesterId,
          name: input.name,
          capacity: input.capacity,
          facilities: { create: facilityRows },
        },
        include: ROOM_INCLUDE,
      });
      return toRecord(created);
    },
    async update(id, patch) {
      // Run within a transaction so a facilities reset + room update either
      // both happen or neither does.
      const updated = await prisma.$transaction(async (tx) => {
        if (patch.facilities !== undefined) {
          const facilityRows = await resolveFacilityIds(prisma, patch.facilities);
          await tx.roomFacility.deleteMany({ where: { roomId: id } });
          if (facilityRows.length > 0) {
            await tx.roomFacility.createMany({
              data: facilityRows.map((f) => ({ roomId: id, facilityId: f.facilityId })),
            });
          }
        }
        const data: Prisma.RoomUpdateInput = {};
        if (patch.name !== undefined) data.name = patch.name;
        if (patch.capacity !== undefined) data.capacity = patch.capacity;
        return tx.room.update({ where: { id }, data, include: ROOM_INCLUDE });
      });
      return toRecord(updated);
    },
    async delete(id) {
      await prisma.room.delete({ where: { id } });
    },
  };
}
