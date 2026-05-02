import { Router } from 'express';
import { validate } from '../middleware/validate';
import {
  createLockedRoomBodySchema,
  listLockedRoomsQuerySchema,
  lockedRoomIdParamsSchema,
  updateLockedRoomBodySchema,
} from '../schemas/locked-rooms';
import { notImplemented } from './_stub';

export function createLockedRoomsRouter(): Router {
  const router = Router();

  // TODO Task 4: requireAuth
  router.get(
    '/',
    validate({ query: listLockedRoomsQuerySchema }),
    notImplemented('GET /locked-rooms'),
  );

  // TODO Task 4: requireAuth
  router.get(
    '/:id',
    validate({ params: lockedRoomIdParamsSchema }),
    notImplemented('GET /locked-rooms/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.post(
    '/',
    validate({ body: createLockedRoomBodySchema }),
    notImplemented('POST /locked-rooms'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.patch(
    '/:id',
    validate({ params: lockedRoomIdParamsSchema, body: updateLockedRoomBodySchema }),
    notImplemented('PATCH /locked-rooms/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.delete(
    '/:id',
    validate({ params: lockedRoomIdParamsSchema }),
    notImplemented('DELETE /locked-rooms/:id'),
  );

  return router;
}
