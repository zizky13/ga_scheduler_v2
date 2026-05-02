/**
 * Bare-minimum auth middleware needed by Phase 2 Task 3.
 *
 * Scope is intentionally narrow:
 *   - `requireAuth`  — Bearer JWT → `req.user = { id, role, email }`. 401 on
 *     missing or invalid token.
 *   - `requireRole` — must run after `requireAuth`. 403 on role mismatch.
 *
 * `requireOwnerOrAdmin`, `allowFields`, `rateLimitAuth`, and `rateLimitRun`
 * are deferred to Task 4 per backlog.md (Phase 2 item 4).
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AuthError, AuthzError } from '../errors';
import { verifyAccessToken, type AccessTokenClaims, type AuthRole } from '../lib/auth';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AccessTokenClaims;
  }
}

const BEARER_PREFIX = /^Bearer\s+(.+)$/iu;

export function requireAuth(): RequestHandler {
  return function requireAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    const header = req.header('authorization');
    if (!header) {
      next(new AuthError('UNAUTHORIZED', 'Missing Authorization header'));
      return;
    }
    const match = BEARER_PREFIX.exec(header);
    if (!match) {
      next(new AuthError('UNAUTHORIZED', 'Authorization header must use Bearer scheme'));
      return;
    }
    const token = match[1]!.trim();
    if (token.length === 0) {
      next(new AuthError('UNAUTHORIZED', 'Empty Bearer token'));
      return;
    }
    try {
      req.user = verifyAccessToken(token);
      next();
    } catch {
      // Don't surface verifier internals — the spec uses a single 401 code.
      next(new AuthError('UNAUTHORIZED', 'Invalid or expired access token'));
    }
  };
}

export function requireRole(role: AuthRole): RequestHandler {
  return function requireRoleMiddleware(req: Request, _res: Response, next: NextFunction): void {
    if (!req.user) {
      // Defensive: callers must put requireAuth first.
      next(new AuthError('UNAUTHORIZED', 'Authentication required'));
      return;
    }
    if (req.user.role !== role) {
      next(new AuthzError('Insufficient role'));
      return;
    }
    next();
  };
}
