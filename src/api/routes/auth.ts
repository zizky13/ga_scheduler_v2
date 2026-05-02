import { Router } from 'express';
import { validate } from '../middleware/validate';
import {
  loginBodySchema,
  logoutBodySchema,
  refreshBodySchema,
  registerBodySchema,
} from '../schemas/auth';
import { notImplemented } from './_stub';

export function createAuthRouter(): Router {
  const router = Router();

  // TODO Task 4: requireAuth, requireRole('admin')
  router.post(
    '/register',
    validate({ body: registerBodySchema }),
    notImplemented('POST /auth/register'),
  );

  // TODO Task 4: rateLimitAuth
  router.post('/login', validate({ body: loginBodySchema }), notImplemented('POST /auth/login'));

  router.post(
    '/refresh',
    validate({ body: refreshBodySchema }),
    notImplemented('POST /auth/refresh'),
  );

  // TODO Task 4: requireAuth
  router.post(
    '/logout',
    validate({ body: logoutBodySchema }),
    notImplemented('POST /auth/logout'),
  );

  // TODO Task 4: requireAuth
  router.get('/me', notImplemented('GET /auth/me'));

  return router;
}
