/**
 * Permission middleware (api_design §4.5 / §4.6).
 *
 *   - `requireOwnerOrAdmin(loadResource)` — admin always passes; non-admins
 *     must own the loaded resource.
 *   - `allowFields(allowList)` — field-level allow list for `user` callers on
 *     resources whose write surface is partially admin-only (Lecturer,
 *     CourseOffering — see §5.3.5 / §5.3.7).
 *
 * Both middleware run after `requireAuth` and read `req.user`.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AuthError, NotFoundError, ValidationError } from '../errors';

export interface OwnedResource {
  createdById: number;
}

export type ResourceLoader = (req: Request) => Promise<OwnedResource | null | undefined>;

/**
 * Resource ownership gate. Admin short-circuits without invoking the loader,
 * so callers can rely on the loader running at most once and only for `user`.
 *
 * Non-owner users get 404 (not 403) per api_design §5.2 — leaking 403 would
 * confirm the resource exists to a caller who has no right to know.
 */
export function requireOwnerOrAdmin(loadResource: ResourceLoader): RequestHandler {
  return async function requireOwnerOrAdminMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.user) {
      next(new AuthError('UNAUTHORIZED', 'Authentication required'));
      return;
    }
    if (req.user.role === 'admin') {
      next();
      return;
    }
    try {
      const resource = await loadResource(req);
      if (!resource || resource.createdById !== req.user.id) {
        next(new NotFoundError());
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * For `user` callers, reject (400 `FIELD_NOT_ALLOWED`) any body keys outside
 * the allow list — surfacing the offending names lets the frontend correct
 * its UI rather than silently dropping data. Admins bypass entirely; the
 * field-level matrix in §4.5 only constrains `user`. Bodies that aren't
 * plain objects pass through (the route's own Zod schema will reject them).
 */
export function allowFields(allowList: readonly string[]): RequestHandler {
  const allowed = new Set(allowList);
  return function allowFieldsMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    if (req.user?.role !== 'user') {
      next();
      return;
    }
    if (!isPlainObject(req.body)) {
      next();
      return;
    }
    const rejected = Object.keys(req.body).filter((key) => !allowed.has(key));
    if (rejected.length > 0) {
      next(
        new ValidationError(
          'Field not allowed for role user',
          rejected.map((field) => ({
            path: [field],
            message: 'Field not allowed for role user',
            code: 'FIELD_NOT_ALLOWED',
          })),
          'FIELD_NOT_ALLOWED',
        ),
      );
      return;
    }
    next();
  };
}
