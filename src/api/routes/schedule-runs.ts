/**
 * `/schedule-runs` routes (api_design §5.3.8, techspec §7.1).
 *
 * Phase 3 Task 5 lands the `POST /` handler with:
 *   - `Idempotency-Key` header — same key + same body returns the original
 *     202; same key + different body → 409 `IDEMPOTENCY_CONFLICT`.
 *   - 5 runs / 5 min per `req.user.id` rate limit (`rateLimitRun`).
 *   - 422 `NO_ACTIVE_SEMESTER` when the target semester has no offerings.
 *   - 503 `QUEUE_UNAVAILABLE` when the BullMQ enqueue throws (Redis down,
 *     queue closed). The row is marked `FAILED` so it isn't orphaned in
 *     `QUEUED`.
 *   - `AuditLog` entry `schedule_run.create` per §8 on successful enqueue.
 *
 * The remaining handlers in this file stay `notImplemented` and will land in
 * Phase 3 Tasks 6 / 7 / 8 / 9.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { rateLimitRun } from '../middleware/rateLimit';
import {
  cancelScheduleRunBodySchema,
  createScheduleRunBodySchema,
  listScheduleRunsQuerySchema,
  overrideAssignmentBodySchema,
  scheduleRunAssignmentParamsSchema,
  scheduleRunIdParamsSchema,
  scheduleRunStreamParamsSchema,
  type CreateScheduleRunBody,
} from '../schemas/schedule-runs';
import {
  AuthError,
  ConflictError,
  DomainError,
  ServiceUnavailableError,
} from '../errors';
import { isPrismaUniqueViolation } from '../lib/prismaErrors';
import { getCrudRepositories } from '../lib/crudContext';
import { writeAudit } from '../lib/audit';
import { enqueueGaPipelineRun } from '../../queue/ga-pipeline';
import type { ScheduleRunRow } from '../../repo/scheduleRunRepo';
import { notImplemented } from './_stub';

const IDEMPOTENCY_HEADER = 'Idempotency-Key';

interface ScheduleRunCreateResponse {
  id: string;
  status: string;
  semesterId: number;
  createdById: number;
  createdAt: string;
}

function toCreateResponse(row: ScheduleRunRow): ScheduleRunCreateResponse {
  return {
    id: row.id,
    status: row.status,
    semesterId: row.semesterId,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Canonical JSON used for idempotency-body comparison. Sorting keys means
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hash identically — clients that
 * regenerate request bodies without preserving key order still match.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

function readIdempotencyKey(req: Request): string | null {
  const raw = req.header(IDEMPOTENCY_HEADER);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function postCreate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new AuthError('UNAUTHORIZED', 'Authentication required'));
      return;
    }
    const body = req.body as CreateScheduleRunBody;
    const idempotencyKey = readIdempotencyKey(req);
    const repos = getCrudRepositories();

    const configJson = canonicalJson(body.config);

    // Idempotent replay path. Per api_design §7: same key + same body returns
    // the original 202; same key + different body → 409.
    if (idempotencyKey) {
      const existing = await repos.scheduleRuns.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        const sameBody =
          existing.semesterId === body.semesterId &&
          existing.configJson === configJson;
        if (!sameBody) {
          next(
            new ConflictError(
              'IDEMPOTENCY_CONFLICT',
              'Idempotency-Key was reused with a different request body',
            ),
          );
          return;
        }
        res.status(202).json(toCreateResponse(existing));
        return;
      }
    }

    // 422 NO_ACTIVE_SEMESTER — the target semester has no offerings, so the
    // GA has nothing to schedule. The error code follows api_design §5.3.8
    // even though strictly speaking it's "no offerings for this semester".
    const offeringCount = await repos.scheduleRuns.countOfferingsForSemester(
      body.semesterId,
    );
    if (offeringCount === 0) {
      next(
        new DomainError(
          'NO_ACTIVE_SEMESTER',
          `Semester ${body.semesterId} has no offerings to schedule`,
          { semesterId: body.semesterId },
        ),
      );
      return;
    }

    let created: ScheduleRunRow;
    try {
      created = await repos.scheduleRuns.create({
        semesterId: body.semesterId,
        createdById: req.user.id,
        configJson,
        idempotencyKey: idempotencyKey ?? null,
      });
    } catch (err) {
      if (isPrismaUniqueViolation(err) && idempotencyKey) {
        // Race: another request with the same key inserted between our
        // findByIdempotencyKey and create. Fall back to the existing row.
        const existing =
          await repos.scheduleRuns.findByIdempotencyKey(idempotencyKey);
        if (existing) {
          const sameBody =
            existing.semesterId === body.semesterId &&
            existing.configJson === configJson;
          if (!sameBody) {
            next(
              new ConflictError(
                'IDEMPOTENCY_CONFLICT',
                'Idempotency-Key was reused with a different request body',
              ),
            );
            return;
          }
          res.status(202).json(toCreateResponse(existing));
          return;
        }
      }
      throw err;
    }

    // Enqueue. If Redis / BullMQ is down, mark the row FAILED so it isn't
    // orphaned in QUEUED, then surface 503 QUEUE_UNAVAILABLE.
    try {
      const enqueueOpts: { idempotencyKey?: string } = {};
      if (idempotencyKey) enqueueOpts.idempotencyKey = idempotencyKey;
      await enqueueGaPipelineRun(created.id, enqueueOpts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await repos.scheduleRuns
        .markFailed(created.id, 'QUEUE_UNAVAILABLE', message)
        .catch(() => {
          // Best-effort cleanup; the original 503 is still the right surface.
        });
      next(
        new ServiceUnavailableError(
          'QUEUE_UNAVAILABLE',
          'Schedule run queue is unavailable',
        ),
      );
      return;
    }

    // §8 audit: `schedule_run.create` carries `{ semesterId, config }`.
    await writeAudit(req, {
      action: 'schedule_run.create',
      entityType: 'ScheduleRun',
      entityId: created.id,
      metadata: {
        before: null,
        after: {
          id: created.id,
          status: created.status,
          semesterId: created.semesterId,
          config: body.config,
          idempotencyKey: created.idempotencyKey,
        },
      },
    });

    res.status(202).json(toCreateResponse(created));
  } catch (err) {
    next(err);
  }
}

export function createScheduleRunsRouter(): Router {
  const router = Router();

  // TODO Phase 3 Task 6: requireAuth, owner-or-admin filtering on list.
  router.get(
    '/',
    validate({ query: listScheduleRunsQuerySchema }),
    notImplemented('GET /schedule-runs'),
  );

  router.post(
    '/',
    requireAuth(),
    rateLimitRun(),
    validate({ body: createScheduleRunBodySchema }),
    postCreate,
  );

  // TODO Phase 3 Task 6: requireAuth, requireOwnerOrAdmin
  router.get(
    '/:id',
    validate({ params: scheduleRunIdParamsSchema }),
    notImplemented('GET /schedule-runs/:id'),
  );

  // TODO Phase 3 Task 7 (SSE): requireAuth, requireOwnerOrAdmin
  router.get(
    '/:id/stream',
    validate({ params: scheduleRunStreamParamsSchema }),
    notImplemented('GET /schedule-runs/:id/stream'),
  );

  // TODO Phase 3 Task 8 (cancel): requireAuth, requireOwnerOrAdmin
  router.post(
    '/:id/cancel',
    validate({
      params: scheduleRunIdParamsSchema,
      body: cancelScheduleRunBodySchema,
    }),
    notImplemented('POST /schedule-runs/:id/cancel'),
  );

  // TODO Phase 3 Task 6: requireAuth, requireOwnerOrAdmin
  router.delete(
    '/:id',
    validate({ params: scheduleRunIdParamsSchema }),
    notImplemented('DELETE /schedule-runs/:id'),
  );

  // TODO Phase 3 Task 9 (assignment override): requireAuth, requireOwnerOrAdmin
  router.put(
    '/:id/assignments/:assignmentId',
    validate({
      params: scheduleRunAssignmentParamsSchema,
      body: overrideAssignmentBodySchema,
    }),
    notImplemented('PUT /schedule-runs/:id/assignments/:assignmentId'),
  );

  return router;
}
