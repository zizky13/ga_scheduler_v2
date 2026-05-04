// TODO Phase 3: instrument every state-changing schedule-run endpoint with
// `writeAudit(...)` per api_design §8 — `schedule_run.create`,
// `schedule_run.cancel`, `schedule_run.delete`, `schedule_run.assignment_override`,
// and the system-emitted `schedule_run.completed` from the worker. All four
// route bodies below are still notImplemented stubs (Phase 2 Task 8 only
// instruments routes that are actually wired), so audit writes are deferred
// until each handler lands.

import { Router } from 'express';
import { validate } from '../middleware/validate';
import {
  cancelScheduleRunBodySchema,
  createScheduleRunBodySchema,
  listScheduleRunsQuerySchema,
  overrideAssignmentBodySchema,
  scheduleRunAssignmentParamsSchema,
  scheduleRunIdParamsSchema,
  scheduleRunStreamParamsSchema,
} from '../schemas/schedule-runs';
import { notImplemented } from './_stub';

export function createScheduleRunsRouter(): Router {
  const router = Router();

  // TODO Task 4: requireAuth, requireOwnerOrAdmin
  router.get(
    '/',
    validate({ query: listScheduleRunsQuerySchema }),
    notImplemented('GET /schedule-runs'),
  );

  // TODO Task 4: requireAuth, rateLimitRun
  router.post(
    '/',
    validate({ body: createScheduleRunBodySchema }),
    notImplemented('POST /schedule-runs'),
  );

  // TODO Task 4: requireAuth, requireOwnerOrAdmin
  router.get(
    '/:id',
    validate({ params: scheduleRunIdParamsSchema }),
    notImplemented('GET /schedule-runs/:id'),
  );

  // TODO Phase 3: SSE handler — declared here so the schema is not orphaned
  // TODO Task 4: requireAuth, requireOwnerOrAdmin
  router.get(
    '/:id/stream',
    validate({ params: scheduleRunStreamParamsSchema }),
    notImplemented('GET /schedule-runs/:id/stream'),
  );

  // TODO Task 4: requireAuth, requireOwnerOrAdmin
  router.post(
    '/:id/cancel',
    validate({
      params: scheduleRunIdParamsSchema,
      body: cancelScheduleRunBodySchema,
    }),
    notImplemented('POST /schedule-runs/:id/cancel'),
  );

  // TODO Task 4: requireAuth, requireOwnerOrAdmin
  router.delete(
    '/:id',
    validate({ params: scheduleRunIdParamsSchema }),
    notImplemented('DELETE /schedule-runs/:id'),
  );

  // TODO Task 4: requireAuth, requireOwnerOrAdmin
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
