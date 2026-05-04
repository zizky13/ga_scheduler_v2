/**
 * `/users` CRUD — admin only (api_design §4.5, §5.3.2).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Role } from '@prisma/client';

import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  listUsersQuerySchema,
  updateUserBodySchema,
  userIdParamsSchema,
  type UpdateUserBody,
} from '../schemas/users';
import { AuthzError, ConflictError, NotFoundError } from '../errors';
import { getCrudRepositories } from '../lib/crudContext';
import { redactPasswordHash, writeAudit } from '../lib/audit';
import { isPrismaNotFound } from '../lib/prismaErrors';
import { buildListResponse } from '../lib/listResponse';
import type { UserRecord } from '../../repo/userRepo';

interface UserWirePayload {
  id: number;
  email: string;
  fullName: string;
  role: 'admin' | 'user';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function roleEnumToWire(role: Role): 'admin' | 'user' {
  return role === 'ADMIN' ? 'admin' : 'user';
}

function roleWireToEnum(role: 'admin' | 'user'): Role {
  return role === 'admin' ? 'ADMIN' : 'USER';
}

function toWire(u: UserRecord): UserWirePayload {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: roleEnumToWire(u.role),
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

interface ListUsersQuery {
  page: number;
  pageSize: number;
  sort?: string;
  role?: 'admin' | 'user';
  isActive?: boolean;
}

interface IdParams {
  id: number;
}

async function getList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as ListUsersQuery;
    const repos = getCrudRepositories();
    const filter: { role?: Role; isActive?: boolean } = {};
    if (q.role !== undefined) filter.role = roleWireToEnum(q.role);
    if (q.isActive !== undefined) filter.isActive = q.isActive;
    const opts: Parameters<typeof repos.users.listUsers>[0] = {
      filter,
      page: q.page,
      pageSize: q.pageSize,
    };
    if (q.sort !== undefined) opts.sort = q.sort;
    const { rows, total } = await repos.users.listUsers(opts);
    res.status(200).json(
      buildListResponse(rows.map(toWire), { page: q.page, pageSize: q.pageSize, total }),
    );
  } catch (err) {
    next(err);
  }
}

async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params as unknown as IdParams;
    const repos = getCrudRepositories();
    const row = await repos.users.findUserById(id);
    if (!row) {
      next(new NotFoundError('User not found'));
      return;
    }
    res.status(200).json(toWire(row));
  } catch (err) {
    next(err);
  }
}

async function patch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params as unknown as IdParams;
    const body = req.body as UpdateUserBody;
    if (!req.user) {
      next(new AuthzError('Authentication required'));
      return;
    }
    // §5.3.2: 403 if attempting to demote oneself.
    if (id === req.user.id && body.role !== undefined) {
      const targetRole = roleWireToEnum(body.role);
      if (req.user.role === 'admin' && targetRole !== 'ADMIN') {
        next(new AuthzError('Cannot demote yourself', undefined, 'SELF_DEMOTION_FORBIDDEN'));
        return;
      }
    }
    // §5.3.2: 403 if attempting to deactivate oneself (mirror of self-demote).
    if (id === req.user.id && body.isActive === false) {
      next(new AuthzError('Cannot deactivate yourself', undefined, 'SELF_DEACTIVATION_FORBIDDEN'));
      return;
    }

    const repos = getCrudRepositories();
    const before = await repos.users.findUserById(id);
    if (!before) {
      next(new NotFoundError('User not found'));
      return;
    }
    const patchInput: { role?: Role; fullName?: string; isActive?: boolean } = {};
    if (body.role !== undefined) patchInput.role = roleWireToEnum(body.role);
    if (body.fullName !== undefined) patchInput.fullName = body.fullName;
    if (body.isActive !== undefined) patchInput.isActive = body.isActive;
    try {
      const updated = await repos.users.updateUser(id, patchInput);
      // api_design §8: `user.update` carries `{ before, after }` with
      // passwordHash redacted. The hash itself is never edited via this
      // endpoint, but we still redact defensively in case the row carries it.
      await writeAudit(req, {
        action: 'user.update',
        entityType: 'User',
        entityId: String(id),
        metadata: {
          before: redactPasswordHash(before),
          after: redactPasswordHash(updated),
        },
      });
      res.status(200).json(toWire(updated));
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('User not found'));
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params as unknown as IdParams;
    if (req.user && id === req.user.id) {
      next(
        new AuthzError(
          'Cannot deactivate yourself',
          undefined,
          'SELF_DEACTIVATION_FORBIDDEN',
        ),
      );
      return;
    }
    const repos = getCrudRepositories();
    const existing = await repos.users.findUserById(id);
    if (!existing) {
      next(new NotFoundError('User not found'));
      return;
    }
    if (!existing.isActive) {
      // Idempotent soft-delete: already deactivated → 409 to surface that the
      // operation is a no-op rather than silently 204.
      next(new ConflictError('ALREADY_DEACTIVATED', 'User is already deactivated'));
      return;
    }
    const after = await repos.users.setActive(id, false);
    // api_design §8: action code is `user.deactivate` (soft-delete), not
    // `user.delete`. Diff captures the active→inactive flip with passwordHash
    // redacted.
    await writeAudit(req, {
      action: 'user.deactivate',
      entityType: 'User',
      entityId: String(id),
      metadata: {
        before: redactPasswordHash(existing),
        after: redactPasswordHash(after),
      },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export function createUsersRouter(): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth(),
    requireRole('admin'),
    validate({ query: listUsersQuerySchema }),
    getList,
  );

  router.get(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: userIdParamsSchema }),
    getOne,
  );

  router.patch(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: userIdParamsSchema, body: updateUserBodySchema }),
    patch,
  );

  router.delete(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: userIdParamsSchema }),
    remove,
  );

  return router;
}
