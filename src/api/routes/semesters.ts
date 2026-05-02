import { Router } from 'express';
import { validate } from '../middleware/validate';
import {
  activateSemesterBodySchema,
  createSemesterBodySchema,
  listSemestersQuerySchema,
  semesterIdParamsSchema,
  updateSemesterBodySchema,
} from '../schemas/semesters';
import { notImplemented } from './_stub';

export function createSemestersRouter(): Router {
  const router = Router();

  // TODO Task 4: requireAuth
  router.get('/', validate({ query: listSemestersQuerySchema }), notImplemented('GET /semesters'));

  // TODO Task 4: requireAuth
  router.get(
    '/:id',
    validate({ params: semesterIdParamsSchema }),
    notImplemented('GET /semesters/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.post(
    '/',
    validate({ body: createSemesterBodySchema }),
    notImplemented('POST /semesters'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.patch(
    '/:id',
    validate({ params: semesterIdParamsSchema, body: updateSemesterBodySchema }),
    notImplemented('PATCH /semesters/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.post(
    '/:id/activate',
    validate({ params: semesterIdParamsSchema, body: activateSemesterBodySchema }),
    notImplemented('POST /semesters/:id/activate'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.delete(
    '/:id',
    validate({ params: semesterIdParamsSchema }),
    notImplemented('DELETE /semesters/:id'),
  );

  return router;
}
