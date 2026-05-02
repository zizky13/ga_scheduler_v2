import { Router } from 'express';
import { validate } from '../middleware/validate';
import {
  courseIdParamsSchema,
  createCourseBodySchema,
  listCoursesQuerySchema,
  updateCourseBodySchema,
} from '../schemas/courses';
import { notImplemented } from './_stub';

export function createCoursesRouter(): Router {
  const router = Router();

  // TODO Task 4: requireAuth
  router.get('/', validate({ query: listCoursesQuerySchema }), notImplemented('GET /courses'));

  // TODO Task 4: requireAuth
  router.get(
    '/:id',
    validate({ params: courseIdParamsSchema }),
    notImplemented('GET /courses/:id'),
  );

  // TODO Task 4: requireAuth
  router.post('/', validate({ body: createCourseBodySchema }), notImplemented('POST /courses'));

  // TODO Task 4: requireAuth
  router.patch(
    '/:id',
    validate({ params: courseIdParamsSchema, body: updateCourseBodySchema }),
    notImplemented('PATCH /courses/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.delete(
    '/:id',
    validate({ params: courseIdParamsSchema }),
    notImplemented('DELETE /courses/:id'),
  );

  return router;
}
