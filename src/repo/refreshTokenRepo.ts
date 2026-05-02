/**
 * Thin repository facade around `prisma.refreshToken`.
 *
 * The schema (prisma/schema.prisma) stores only the SHA-256 of the opaque
 * token; raw values never live in the DB. Lookups happen by hash.
 *
 * `findActiveByHash` filters out revoked / expired rows so callers never
 * accidentally accept a stale token. Single-use rotation is enforced at the
 * route layer via `revokeById` + `createRefreshToken`.
 */

import type { PrismaClient, RefreshToken } from '@prisma/client';

export type RefreshTokenRecord = Pick<
  RefreshToken,
  'id' | 'userId' | 'tokenHash' | 'expiresAt' | 'revokedAt' | 'userAgent' | 'ipAddress' | 'createdAt'
>;

export interface CreateRefreshTokenInput {
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface RefreshTokenRepository {
  createRefreshToken(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord>;
  findActiveByHash(tokenHash: string, now?: Date): Promise<RefreshTokenRecord | null>;
  revokeById(id: string, when?: Date): Promise<void>;
  revokeAllForUser(userId: number, when?: Date): Promise<number>;
}

const REFRESH_SELECT = {
  id: true,
  userId: true,
  tokenHash: true,
  expiresAt: true,
  revokedAt: true,
  userAgent: true,
  ipAddress: true,
  createdAt: true,
} as const;

export function createRefreshTokenRepository(prisma: PrismaClient): RefreshTokenRepository {
  return {
    async createRefreshToken(input) {
      return prisma.refreshToken.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          userAgent: input.userAgent ?? null,
          ipAddress: input.ipAddress ?? null,
        },
        select: REFRESH_SELECT,
      });
    },
    async findActiveByHash(tokenHash, now = new Date()) {
      const row = await prisma.refreshToken.findUnique({
        where: { tokenHash },
        select: REFRESH_SELECT,
      });
      if (!row) return null;
      if (row.revokedAt !== null) return null;
      if (row.expiresAt.getTime() <= now.getTime()) return null;
      return row;
    },
    async revokeById(id, when = new Date()) {
      await prisma.refreshToken.update({
        where: { id },
        data: { revokedAt: when },
      });
    },
    async revokeAllForUser(userId, when = new Date()) {
      const result = await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: when },
      });
      return result.count;
    },
  };
}
