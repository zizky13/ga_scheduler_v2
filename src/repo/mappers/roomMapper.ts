/**
 * Room mapper — Prisma `rooms` row (with `RoomFacility[] → Facility`) to
 * `src/types.ts:Room`.
 *
 * Resolves the `RoomFacility` join into a flat `facilities: string[]` of
 * `Facility.code` values, matching the in-memory shape the GA core consumes.
 */

import type { Room } from '../../types';

/**
 * Minimal hand-rolled row shape for a Prisma `Room` row included with its
 * `RoomFacility[]` join. We don't import Prisma's generated `*GetPayload`
 * types here so this module stays Prisma-import-free at runtime; the seam
 * runs through `scheduleRepo.ts` which is the only Prisma-aware file.
 */
export interface RoomRow {
  id: number;
  name: string;
  capacity: number;
  facilities: ReadonlyArray<{
    facility: { code: string };
  }>;
}

/**
 * Pure row→domain mapping. Throws if a join row is missing its nested
 * `facility.code` (defensive — Prisma's `Restrict` cascade should prevent it,
 * but the boundary validates anyway).
 */
export function mapRoomRow(row: RoomRow): Room {
  const facilities = row.facilities.map((rf, i) => {
    const code = rf.facility?.code;
    if (typeof code !== 'string' || code.length === 0) {
      throw new Error(
        `Room ${row.id}: facilities[${i}] missing or empty facility.code`,
      );
    }
    return code;
  });

  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    facilities,
  };
}
