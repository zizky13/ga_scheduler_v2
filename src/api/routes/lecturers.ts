import { Router } from 'express';
import { validate } from '../middleware/validate';
import {
  createLecturerBodySchema,
  lecturerIdParamsSchema,
  listLecturersQuerySchema,
  updateLecturerBodySchema,
} from '../schemas/lecturers';
import { notImplemented } from './_stub';

export function createLecturersRouter(): Router {
  const router = Router();

  // TODO Task 4: requireAuth
  router.get(
    '/',
    validate({ query: listLecturersQuerySchema }),
    notImplemented('GET /lecturers'),
  );

  // TODO Task 4: requireAuth
  router.get(
    '/:id',
    validate({ params: lecturerIdParamsSchema }),
    notImplemented('GET /lecturers/:id'),
  );

  // TODO Task 4: requireAuth, allowFields(...) for `user`
  router.post(
    '/',
    validate({ body: createLecturerBodySchema }),
    notImplemented('POST /lecturers'),
  );

  // TODO Task 4: requireAuth, allowFields(...) for `user`
  router.patch(
    '/:id',
    validate({ params: lecturerIdParamsSchema, body: updateLecturerBodySchema }),
    notImplemented('PATCH /lecturers/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.delete(
    '/:id',
    validate({ params: lecturerIdParamsSchema }),
    notImplemented('DELETE /lecturers/:id'),
  );

  return router;
}
