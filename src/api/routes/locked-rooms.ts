/**
 * `/locked-rooms` CRUD — admin write, user read (api_design §4.5, §5.3.4).
 *
 * Special-case rules from §5.3.4:
 *   - `POST` fills `lockedById` from `req.user.id` (never trusted from body).
 *   - `LockedRoom.offeringId` is `@unique` per schema → 409 on duplicate.
 *   - Locks cannot be created or modified while a `ScheduleRun` for the same
 *     semester is `RUNNING` (techspec §2.1).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  createLockedRoomBodySchema,
  listLockedRoomsQuerySchema,
  lockedRoomIdParamsSchema,
  updateLockedRoomBodySchema,
  type CreateLockedRoomBody,
  type UpdateLockedRoomBody,
} from '../schemas/locked-rooms';
import { AuthError, ConflictError, NotFoundError, ValidationError } from '../errors';
import { getCrudRepositories } from '../lib/crudContext';
import {
  isPrismaForeignKeyError,
  isPrismaNotFound,
  isPrismaUniqueViolation,
} from '../lib/prismaErrors';
import { buildListResponse } from '../lib/listResponse';
import type { LockedRoomRecord } from '../../repo/lockedRoomRepo';

interface LockedRoomWirePayload {
  id: number;
  semesterId: number;
  offeringId: number;
  roomId: number;
  lockedById: number;
  lockedAt: string;
  reason: string | null;
}

function toWire(l: LockedRoomRecord): LockedRoomWirePayload {
  return {
    id: l.id,
    semesterId: l.semesterId,
    offeringId: l.offeringId,
    roomId: l.roomId,
    lockedById: l.lockedById,
    lockedAt: l.lockedAt.toISOString(),
    reason: l.reason,
  };
}

interface ListQuery {
  page: number;
  pageSize: number;
  sort?: string;
  semesterId?: number;
  offeringId?: number;
  roomId?: number;
}

interface IdParams {
  id: number;
}

async function getList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as ListQuery;
    const repos = getCrudRepositories();
    const filter: { semesterId?: number; offeringId?: number; roomId?: number } = {};
    if (q.semesterId !== undefined) filter.semesterId = q.semesterId;
    if (q.offeringId !== undefined) filter.offeringId = q.offeringId;
    if (q.roomId !== undefined) filter.roomId = q.roomId;
    const opts: Parameters<typeof repos.lockedRooms.list>[0] = {
      filter,
      page: q.page,
      pageSize: q.pageSize,
    };
    if (q.sort !== undefined) opts.sort = q.sort;
    const { rows, total } = await repos.lockedRooms.list(opts);
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
    const row = await repos.lockedRooms.findById(id);
    if (!row) {
      next(new NotFoundError('Locked room not found'));
      return;
    }
    res.status(200).json(toWire(row));
  } catch (err) {
    next(err);
  }
}

async function postCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(new AuthError('UNAUTHORIZED', 'Authentication required'));
      return;
    }
    const body = req.body as CreateLockedRoomBody;
    const repos = getCrudRepositories();

    if (await repos.lockedRooms.hasRunningScheduleRunForSemester(body.semesterId)) {
      next(
        new ConflictError(
          'SCHEDULE_RUN_RUNNING',
          'A schedule run is currently RUNNING for this semester; locked rooms cannot be modified until it terminates',
        ),
      );
      return;
    }

    try {
      const created = await repos.lockedRooms.create({
        semesterId: body.semesterId,
        offeringId: body.offeringId,
        roomId: body.roomId,
        lockedById: req.user.id,
        reason: body.reason ?? null,
      });
      res.status(201).json(toWire(created));
    } catch (err) {
      if (isPrismaUniqueViolation(err)) {
        next(
          new ConflictError(
            'OFFERING_ALREADY_LOCKED',
            'A locked-room entry already exists for this offering',
          ),
        );
        return;
      }
      if (isPrismaForeignKeyError(err)) {
        next(
          new ValidationError(
            'Invalid semester / offering / room reference',
            [
              {
                path: [],
                message: 'One of semesterId / offeringId / roomId references a missing row',
                code: 'INVALID_REFERENCE',
              },
            ],
            'INVALID_REFERENCE',
          ),
        );
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

async function patch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params as unknown as IdParams;
    const body = req.body as UpdateLockedRoomBody;
    const repos = getCrudRepositories();

    const existing = await repos.lockedRooms.findById(id);
    if (!existing) {
      next(new NotFoundError('Locked room not found'));
      return;
    }

    if (await repos.lockedRooms.hasRunningScheduleRunForSemester(existing.semesterId)) {
      next(
        new ConflictError(
          'SCHEDULE_RUN_RUNNING',
          'A schedule run is currently RUNNING for this semester; locked rooms cannot be modified until it terminates',
        ),
      );
      return;
    }

    const patchInput: { roomId?: number; reason?: string | null } = {};
    if (body.roomId !== undefined) patchInput.roomId = body.roomId;
    if (body.reason !== undefined) patchInput.reason = body.reason;

    try {
      const updated = await repos.lockedRooms.update(id, patchInput);
      res.status(200).json(toWire(updated));
    } catch (err) {
      if (isPrismaForeignKeyError(err)) {
        next(
          new ValidationError(
            'Invalid roomId',
            [
              { path: ['roomId'], message: 'Room does not exist', code: 'INVALID_REFERENCE' },
            ],
            'INVALID_REFERENCE',
          ),
        );
        return;
      }
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Locked room not found'));
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
    const repos = getCrudRepositories();
    const existing = await repos.lockedRooms.findById(id);
    if (!existing) {
      next(new NotFoundError('Locked room not found'));
      return;
    }
    if (await repos.lockedRooms.hasRunningScheduleRunForSemester(existing.semesterId)) {
      next(
        new ConflictError(
          'SCHEDULE_RUN_RUNNING',
          'A schedule run is currently RUNNING for this semester; locked rooms cannot be modified until it terminates',
        ),
      );
      return;
    }
    try {
      await repos.lockedRooms.delete(id);
      res.status(204).end();
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Locked room not found'));
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

export function createLockedRoomsRouter(): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth(),
    validate({ query: listLockedRoomsQuerySchema }),
    getList,
  );

  router.get(
    '/:id',
    requireAuth(),
    validate({ params: lockedRoomIdParamsSchema }),
    getOne,
  );

  router.post(
    '/',
    requireAuth(),
    requireRole('admin'),
    validate({ body: createLockedRoomBodySchema }),
    postCreate,
  );

  router.patch(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: lockedRoomIdParamsSchema, body: updateLockedRoomBodySchema }),
    patch,
  );

  router.delete(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: lockedRoomIdParamsSchema }),
    remove,
  );

  return router;
}
