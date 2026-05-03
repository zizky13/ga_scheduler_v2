/**
 * `/rooms` CRUD — admin write, user read (api_design §4.5, §5.3.4).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  createRoomBodySchema,
  listRoomsQuerySchema,
  roomIdParamsSchema,
  updateRoomBodySchema,
  type CreateRoomBody,
  type UpdateRoomBody,
} from '../schemas/rooms';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { getCrudRepositories } from '../lib/crudContext';
import {
  isPrismaForeignKeyError,
  isPrismaNotFound,
  isPrismaUniqueViolation,
} from '../lib/prismaErrors';
import { buildListResponse } from '../lib/listResponse';
import { UnknownFacilityCodeError, type RoomRecord } from '../../repo/roomRepo';

interface RoomWirePayload {
  id: number;
  semesterId: number;
  name: string;
  capacity: number;
  facilities: string[];
  createdAt: string;
  updatedAt: string;
}

function toWire(r: RoomRecord): RoomWirePayload {
  return {
    id: r.id,
    semesterId: r.semesterId,
    name: r.name,
    capacity: r.capacity,
    facilities: r.facilities,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

interface ListQuery {
  page: number;
  pageSize: number;
  sort?: string;
  semesterId?: number;
}

interface IdParams {
  id: number;
}

function unknownFacility(err: unknown): UnknownFacilityCodeError | null {
  return err instanceof UnknownFacilityCodeError ? err : null;
}

async function getList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as ListQuery;
    const repos = getCrudRepositories();
    const opts: Parameters<typeof repos.rooms.list>[0] = {
      filter: q.semesterId !== undefined ? { semesterId: q.semesterId } : {},
      page: q.page,
      pageSize: q.pageSize,
    };
    if (q.sort !== undefined) opts.sort = q.sort;
    const { rows, total } = await repos.rooms.list(opts);
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
    const row = await repos.rooms.findById(id);
    if (!row) {
      next(new NotFoundError('Room not found'));
      return;
    }
    res.status(200).json(toWire(row));
  } catch (err) {
    next(err);
  }
}

async function postCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as CreateRoomBody;
    const repos = getCrudRepositories();
    try {
      const created = await repos.rooms.create({
        semesterId: body.semesterId,
        name: body.name,
        capacity: body.capacity,
        facilities: body.facilities,
      });
      res.status(201).json(toWire(created));
    } catch (err) {
      const fac = unknownFacility(err);
      if (fac) {
        next(
          new ValidationError(
            `Unknown facility code(s): ${fac.codes.join(', ')}`,
            fac.codes.map((c) => ({
              path: ['facilities'],
              message: `Unknown facility code: ${c}`,
              code: 'UNKNOWN_FACILITY',
            })),
            'UNKNOWN_FACILITY',
          ),
        );
        return;
      }
      if (isPrismaUniqueViolation(err)) {
        next(new ConflictError('ROOM_NAME_TAKEN', 'Room name already exists for this semester'));
        return;
      }
      if (isPrismaForeignKeyError(err)) {
        next(new ValidationError('Invalid semesterId', [
          { path: ['semesterId'], message: 'Semester does not exist', code: 'INVALID_REFERENCE' },
        ], 'INVALID_REFERENCE'));
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
    const body = req.body as UpdateRoomBody;
    const repos = getCrudRepositories();
    const existing = await repos.rooms.findById(id);
    if (!existing) {
      next(new NotFoundError('Room not found'));
      return;
    }
    const patchInput: { name?: string; capacity?: number; facilities?: string[] } = {};
    if (body.name !== undefined) patchInput.name = body.name;
    if (body.capacity !== undefined) patchInput.capacity = body.capacity;
    if (body.facilities !== undefined) patchInput.facilities = body.facilities;

    try {
      const updated = await repos.rooms.update(id, patchInput);
      res.status(200).json(toWire(updated));
    } catch (err) {
      const fac = unknownFacility(err);
      if (fac) {
        next(
          new ValidationError(
            `Unknown facility code(s): ${fac.codes.join(', ')}`,
            fac.codes.map((c) => ({
              path: ['facilities'],
              message: `Unknown facility code: ${c}`,
              code: 'UNKNOWN_FACILITY',
            })),
            'UNKNOWN_FACILITY',
          ),
        );
        return;
      }
      if (isPrismaUniqueViolation(err)) {
        next(new ConflictError('ROOM_NAME_TAKEN', 'Room name already exists for this semester'));
        return;
      }
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Room not found'));
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
    try {
      await repos.rooms.delete(id);
      res.status(204).end();
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Room not found'));
        return;
      }
      if (isPrismaForeignKeyError(err)) {
        next(
          new ConflictError(
            'ROOM_REFERENCED',
            'Cannot delete a room referenced by offerings or locked rooms',
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

export function createRoomsRouter(): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth(),
    validate({ query: listRoomsQuerySchema }),
    getList,
  );

  router.get(
    '/:id',
    requireAuth(),
    validate({ params: roomIdParamsSchema }),
    getOne,
  );

  router.post(
    '/',
    requireAuth(),
    requireRole('admin'),
    validate({ body: createRoomBodySchema }),
    postCreate,
  );

  router.patch(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: roomIdParamsSchema, body: updateRoomBodySchema }),
    patch,
  );

  router.delete(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: roomIdParamsSchema }),
    remove,
  );

  return router;
}
