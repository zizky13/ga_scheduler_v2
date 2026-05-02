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
