import { Router } from 'express';
import { validate } from '../middleware/validate';
import {
  courseOfferingIdParamsSchema,
  createCourseOfferingBodySchema,
  listCourseOfferingsQuerySchema,
  updateCourseOfferingBodySchema,
  updateStudentCountBodySchema,
} from '../schemas/course-offerings';
import { notImplemented } from './_stub';

export function createCourseOfferingsRouter(): Router {
  const router = Router();

  // TODO Task 4: requireAuth
  router.get(
    '/',
    validate({ query: listCourseOfferingsQuerySchema }),
    notImplemented('GET /course-offerings'),
  );

  // TODO Task 4: requireAuth
  router.get(
    '/:id',
    validate({ params: courseOfferingIdParamsSchema }),
    notImplemented('GET /course-offerings/:id'),
  );

  // TODO Task 4: requireAuth, allowFields(...) for `user`
  router.post(
    '/',
    validate({ body: createCourseOfferingBodySchema }),
    notImplemented('POST /course-offerings'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.patch(
    '/:id',
    validate({
      params: courseOfferingIdParamsSchema,
      body: updateCourseOfferingBodySchema,
    }),
    notImplemented('PATCH /course-offerings/:id'),
  );

  // TODO Task 4: requireAuth
  router.patch(
    '/:id/student-count',
    validate({
      params: courseOfferingIdParamsSchema,
      body: updateStudentCountBodySchema,
    }),
    notImplemented('PATCH /course-offerings/:id/student-count'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.delete(
    '/:id',
    validate({ params: courseOfferingIdParamsSchema }),
    notImplemented('DELETE /course-offerings/:id'),
  );

  return router;
}
