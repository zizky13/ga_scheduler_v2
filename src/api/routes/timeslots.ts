import { Router } from 'express';
import { validate } from '../middleware/validate';
import {
  createTimeslotBodySchema,
  listTimeslotsQuerySchema,
  timeslotIdParamsSchema,
  updateTimeslotBodySchema,
} from '../schemas/timeslots';
import { notImplemented } from './_stub';

export function createTimeslotsRouter(): Router {
  const router = Router();

  // TODO Task 4: requireAuth
  router.get('/', validate({ query: listTimeslotsQuerySchema }), notImplemented('GET /timeslots'));

  // TODO Task 4: requireAuth
  router.get(
    '/:id',
    validate({ params: timeslotIdParamsSchema }),
    notImplemented('GET /timeslots/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.post(
    '/',
    validate({ body: createTimeslotBodySchema }),
    notImplemented('POST /timeslots'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.patch(
    '/:id',
    validate({ params: timeslotIdParamsSchema, body: updateTimeslotBodySchema }),
    notImplemented('PATCH /timeslots/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.delete(
    '/:id',
    validate({ params: timeslotIdParamsSchema }),
    notImplemented('DELETE /timeslots/:id'),
  );

  return router;
}
