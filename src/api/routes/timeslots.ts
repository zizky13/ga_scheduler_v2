/**
 * `/timeslots` CRUD — admin write, user read (api_design §4.5, §5.3.4).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Weekday } from '@prisma/client';

import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  createTimeslotBodySchema,
  listTimeslotsQuerySchema,
  timeslotIdParamsSchema,
  updateTimeslotBodySchema,
  type CreateTimeslotBody,
  type UpdateTimeslotBody,
} from '../schemas/timeslots';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { getCrudRepositories } from '../lib/crudContext';
import { writeAudit } from '../lib/audit';
import {
  isPrismaForeignKeyError,
  isPrismaNotFound,
  isPrismaUniqueViolation,
} from '../lib/prismaErrors';
import { buildListResponse } from '../lib/listResponse';
import type { TimeSlotRecord } from '../../repo/timeslotRepo';

interface TimeSlotWirePayload {
  id: number;
  semesterId: number;
  day: Weekday;
  startTime: string;
  endTime: string;
}

function toWire(t: TimeSlotRecord): TimeSlotWirePayload {
  return {
    id: t.id,
    semesterId: t.semesterId,
    day: t.day,
    startTime: t.startTime,
    endTime: t.endTime,
  };
}

interface ListQuery {
  page: number;
  pageSize: number;
  sort?: string;
  semesterId?: number;
  day?: Weekday;
}

interface IdParams {
  id: number;
}

async function getList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as ListQuery;
    const repos = getCrudRepositories();
    const filter: { semesterId?: number; day?: Weekday } = {};
    if (q.semesterId !== undefined) filter.semesterId = q.semesterId;
    if (q.day !== undefined) filter.day = q.day;
    const opts: Parameters<typeof repos.timeSlots.list>[0] = {
      filter,
      page: q.page,
      pageSize: q.pageSize,
    };
    if (q.sort !== undefined) opts.sort = q.sort;
    const { rows, total } = await repos.timeSlots.list(opts);
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
    const row = await repos.timeSlots.findById(id);
    if (!row) {
      next(new NotFoundError('Timeslot not found'));
      return;
    }
    res.status(200).json(toWire(row));
  } catch (err) {
    next(err);
  }
}

async function postCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as CreateTimeslotBody;
    const repos = getCrudRepositories();
    try {
      const created = await repos.timeSlots.create({
        semesterId: body.semesterId,
        day: body.day,
        startTime: body.startTime,
        endTime: body.endTime,
      });
      await writeAudit(req, {
        action: 'time_slot.create',
        entityType: 'TimeSlot',
        entityId: String(created.id),
        metadata: { before: null, after: created },
      });
      res.status(201).json(toWire(created));
    } catch (err) {
      if (isPrismaUniqueViolation(err)) {
        next(
          new ConflictError(
            'TIMESLOT_TAKEN',
            'Timeslot already exists for this semester / day / window',
          ),
        );
        return;
      }
      if (isPrismaForeignKeyError(err)) {
        next(
          new ValidationError(
            'Invalid semesterId',
            [
              {
                path: ['semesterId'],
                message: 'Semester does not exist',
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
    const body = req.body as UpdateTimeslotBody;
    const repos = getCrudRepositories();
    // Fetch unconditionally — we need `before` for the audit row anyway, and
    // PATCH bound-validation also wants the existing row when only one of
    // startTime / endTime is supplied.
    const existing = await repos.timeSlots.findById(id);
    if (!existing) {
      next(new NotFoundError('Timeslot not found'));
      return;
    }
    if (body.startTime !== undefined || body.endTime !== undefined) {
      const startTime = body.startTime ?? existing.startTime;
      const endTime = body.endTime ?? existing.endTime;
      if (startTime >= endTime) {
        next(
          new ValidationError(
            'startTime must be before endTime',
            [{ path: ['endTime'], message: 'startTime must be before endTime' }],
          ),
        );
        return;
      }
    }
    try {
      const updated = await repos.timeSlots.update(id, body);
      await writeAudit(req, {
        action: 'time_slot.update',
        entityType: 'TimeSlot',
        entityId: String(id),
        metadata: { before: existing, after: updated },
      });
      res.status(200).json(toWire(updated));
    } catch (err) {
      if (isPrismaUniqueViolation(err)) {
        next(
          new ConflictError(
            'TIMESLOT_TAKEN',
            'Timeslot already exists for this semester / day / window',
          ),
        );
        return;
      }
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Timeslot not found'));
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
    const existing = await repos.timeSlots.findById(id);
    try {
      await repos.timeSlots.delete(id);
      if (existing) {
        await writeAudit(req, {
          action: 'time_slot.delete',
          entityType: 'TimeSlot',
          entityId: String(id),
          metadata: { before: existing, after: null },
        });
      }
      res.status(204).end();
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Timeslot not found'));
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

export function createTimeslotsRouter(): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth(),
    validate({ query: listTimeslotsQuerySchema }),
    getList,
  );

  router.get(
    '/:id',
    requireAuth(),
    validate({ params: timeslotIdParamsSchema }),
    getOne,
  );

  router.post(
    '/',
    requireAuth(),
    requireRole('admin'),
    validate({ body: createTimeslotBodySchema }),
    postCreate,
  );

  router.patch(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: timeslotIdParamsSchema, body: updateTimeslotBodySchema }),
    patch,
  );

  router.delete(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: timeslotIdParamsSchema }),
    remove,
  );

  return router;
}
