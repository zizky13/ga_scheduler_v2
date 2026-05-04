/**
 * Thin repository facade around `prisma.auditLog` for the audit-trail writes
 * emitted by every state-changing API endpoint (api_design §8).
 *
 * Audit rows are append-only; the only write operation is `create`. The
 * `metadata` column on the Prisma model is `String?` (a JSON-serialized
 * payload — see `prisma/schema.prisma` lines 437–454), so this repo accepts a
 * structured object at the boundary and serializes it once before persisting.
 *
 * Per api_design §7.2 line 799, `requestId` rides inside `metadata` rather
 * than as a top-level column — the schema does not (yet) carry a dedicated
 * column for it. Keep this fact local to the repo + the audit helper so
 * callers don't have to think about the encoding.
 */

import type { PrismaClient, AuditLog } from '@prisma/client';

export type AuditLogRecord = Pick<
  AuditLog,
  | 'id'
  | 'actorId'
  | 'action'
  | 'entityType'
  | 'entityId'
  | 'metadata'
  | 'ipAddress'
  | 'userAgent'
  | 'createdAt'
>;

export interface CreateAuditLogInput {
  actorId: number | null;
  action: string;
  entityType: string;
  entityId: string;
  /**
   * Structured payload merged with `requestId` upstream by the audit helper.
   * Persisted as a JSON-serialized string in the `metadata` column.
   */
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditLogRepository {
  create(input: CreateAuditLogInput): Promise<AuditLogRecord>;
}

const AUDIT_LOG_SELECT = {
  id: true,
  actorId: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
} as const;

export function createAuditLogRepository(prisma: PrismaClient): AuditLogRepository {
  return {
    async create(input) {
      const metadataJson =
        input.metadata === null || input.metadata === undefined
          ? null
          : JSON.stringify(input.metadata);
      return prisma.auditLog.create({
        data: {
          actorId: input.actorId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          metadata: metadataJson,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
        select: AUDIT_LOG_SELECT,
      });
    },
  };
}
