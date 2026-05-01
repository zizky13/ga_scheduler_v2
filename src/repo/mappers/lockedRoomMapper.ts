/**
 * LockedRoom mapper — Prisma `locked_rooms` row to `src/types.ts:LockedRoom`.
 *
 * Straight 1:1 mapping with `lockedAt` preserved as a `Date`. `reason` is
 * passed through (`null` allowed). Per api_design §3.5, this signal stays
 * separate from `CourseOffering.isFixed`; the Pre-GA `entityTagger` merges
 * the two to compute `PreGACandidate.isFixedRoom`.
 */

import type { LockedRoom } from '../../types';

export interface LockedRoomRow {
  id: number;
  semesterId: number;
  offeringId: number;
  roomId: number;
  lockedById: number;
  lockedAt: Date;
  reason: string | null;
}

export function mapLockedRoomRow(row: LockedRoomRow): LockedRoom {
  return {
    id: row.id,
    semesterId: row.semesterId,
    offeringId: row.offeringId,
    roomId: row.roomId,
    lockedById: row.lockedById,
    lockedAt: row.lockedAt,
    reason: row.reason,
  };
}
