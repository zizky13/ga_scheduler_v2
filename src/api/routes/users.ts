import { Router } from 'express';
import { validate } from '../middleware/validate';
import {
  listUsersQuerySchema,
  updateUserBodySchema,
  userIdParamsSchema,
} from '../schemas/users';
import { notImplemented } from './_stub';

export function createUsersRouter(): Router {
  const router = Router();

  // TODO Task 4: requireAuth, requireRole('admin')
  router.get('/', validate({ query: listUsersQuerySchema }), notImplemented('GET /users'));

  // TODO Task 4: requireAuth, requireRole('admin')
  router.get(
    '/:id',
    validate({ params: userIdParamsSchema }),
    notImplemented('GET /users/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.patch(
    '/:id',
    validate({ params: userIdParamsSchema, body: updateUserBodySchema }),
    notImplemented('PATCH /users/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.delete(
    '/:id',
    validate({ params: userIdParamsSchema }),
    notImplemented('DELETE /users/:id'),
  );

  return router;
}
