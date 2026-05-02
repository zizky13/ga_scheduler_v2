import { Router } from 'express';
import { validate } from '../middleware/validate';
import {
  createFacilityBodySchema,
  facilityIdParamsSchema,
  listFacilitiesQuerySchema,
  updateFacilityBodySchema,
} from '../schemas/facilities';
import { notImplemented } from './_stub';

export function createFacilitiesRouter(): Router {
  const router = Router();

  // TODO Task 4: requireAuth
  router.get(
    '/',
    validate({ query: listFacilitiesQuerySchema }),
    notImplemented('GET /facilities'),
  );

  // TODO Task 4: requireAuth
  router.get(
    '/:id',
    validate({ params: facilityIdParamsSchema }),
    notImplemented('GET /facilities/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.post(
    '/',
    validate({ body: createFacilityBodySchema }),
    notImplemented('POST /facilities'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.patch(
    '/:id',
    validate({ params: facilityIdParamsSchema, body: updateFacilityBodySchema }),
    notImplemented('PATCH /facilities/:id'),
  );

  // TODO Task 4: requireAuth, requireRole('admin')
  router.delete(
    '/:id',
    validate({ params: facilityIdParamsSchema }),
    notImplemented('DELETE /facilities/:id'),
  );

  return router;
}
