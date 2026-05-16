import { Router, type Request, type Response, type NextFunction } from 'express';

import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { listAuditLogsQuerySchema } from '../schemas/audit-logs';
import { getCrudRepositories } from '../lib/crudContext';
import { buildListResponse } from '../lib/listResponse';
import type { AuditLogRecord } from '../../repo/auditLogRepo';

interface AuditLogWirePayload {
  id: number;
  actorId: number | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

function toWire(row: AuditLogRecord): AuditLogWirePayload {
  let parsedMeta: unknown = null;
  if (row.metadata) {
    try { parsedMeta = JSON.parse(row.metadata); } catch { parsedMeta = row.metadata; }
  }
  return {
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: parsedMeta,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

interface ListQuery {
  page: number;
  pageSize: number;
  sort?: string;
  actorId?: number;
  entityType?: string;
  action?: string;
}

async function getList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as ListQuery;
    const repos = getCrudRepositories();
    const filter: { actorId?: number; entityType?: string; action?: string } = {};
    if (q.actorId !== undefined) filter.actorId = q.actorId;
    if (q.entityType !== undefined) filter.entityType = q.entityType;
    if (q.action !== undefined) filter.action = q.action;
    const opts = {
      filter,
      page: q.page,
      pageSize: q.pageSize,
      sort: q.sort,
    };
    const { rows, total } = await repos.auditLogs.list(opts);
    res.status(200).json(
      buildListResponse(rows.map(toWire), { page: q.page, pageSize: q.pageSize, total }),
    );
  } catch (err) {
    next(err);
  }
}

export function createAuditLogsRouter(): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth(),
    requireRole('admin'),
    validate({ query: listAuditLogsQuerySchema }),
    getList,
  );

  return router;
}
