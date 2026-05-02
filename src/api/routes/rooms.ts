import { Router } from 'express';
import { validate } from '../middleware/validate';
import {
  createRoomBodySchema,
  listRoomsQuerySchema,
  roomIdParamsSchema,
  updateRoomBodySchema,
} from '../schemas/rooms';
import { notImplemented } from './_stub';

export function createRoomsRouter(): Router {
  const router = Router();

  // TODO Task 4: requireAuth
  router.get('/', validate({ query: listRoomsQuerySchema }), notImplemented('GET /rooms'));

  // TODO Task 4: requireAuth
  router.get(
    '/:id',
    validate({ params: roomIdParamsSchema }),
    notImplemented('GET /rooms/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.post('/', validate({ body: createRoomBodySchema }), notImplemented('POST /rooms'));

  // TODO Task 4: requireAuth, requireRole('admin')
  router.patch(
    '/:id',
    validate({ params: roomIdParamsSchema, body: updateRoomBodySchema }),
    notImplemented('PATCH /rooms/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.delete(
    '/:id',
    validate({ params: roomIdParamsSchema }),
    notImplemented('DELETE /rooms/:id'),
  );

  return router;
}
