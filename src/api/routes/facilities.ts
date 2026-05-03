/**
 * `/facilities` CRUD — admin write, user read (api_design §4.5, §5.3.4).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  createFacilityBodySchema,
  facilityIdParamsSchema,
  listFacilitiesQuerySchema,
  updateFacilityBodySchema,
  type CreateFacilityBody,
  type UpdateFacilityBody,
} from '../schemas/facilities';
import { ConflictError, NotFoundError } from '../errors';
import { getCrudRepositories } from '../lib/crudContext';
import { isPrismaForeignKeyError, isPrismaNotFound, isPrismaUniqueViolation } from '../lib/prismaErrors';
import { buildListResponse } from '../lib/listResponse';
import type { FacilityRecord } from '../../repo/facilityRepo';

interface ListQuery {
  page: number;
  pageSize: number;
  sort?: string;
}

interface IdParams {
  id: number;
}

function toWire(f: FacilityRecord): FacilityRecord {
  // Facility shape is already wire-clean: { id, code, label }.
  return { id: f.id, code: f.code, label: f.label };
}

async function getList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as ListQuery;
    const repos = getCrudRepositories();
    const opts: Parameters<typeof repos.facilities.list>[0] = {
      page: q.page,
      pageSize: q.pageSize,
    };
    if (q.sort !== undefined) opts.sort = q.sort;
    const { rows, total } = await repos.facilities.list(opts);
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
    const row = await repos.facilities.findById(id);
    if (!row) {
      next(new NotFoundError('Facility not found'));
      return;
    }
    res.status(200).json(toWire(row));
  } catch (err) {
    next(err);
  }
}

async function postCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as CreateFacilityBody;
    const repos = getCrudRepositories();
    try {
      const created = await repos.facilities.create({ code: body.code, label: body.label });
      res.status(201).json(toWire(created));
    } catch (err) {
      if (isPrismaUniqueViolation(err)) {
        next(new ConflictError('FACILITY_CODE_TAKEN', 'Facility code already in use'));
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
    const body = req.body as UpdateFacilityBody;
    const repos = getCrudRepositories();
    try {
      const updated = await repos.facilities.update(id, body);
      res.status(200).json(toWire(updated));
    } catch (err) {
      if (isPrismaUniqueViolation(err)) {
        next(new ConflictError('FACILITY_CODE_TAKEN', 'Facility code already in use'));
        return;
      }
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Facility not found'));
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
      await repos.facilities.delete(id);
      res.status(204).end();
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Facility not found'));
        return;
      }
      if (isPrismaForeignKeyError(err)) {
        // Schema sets onDelete: Restrict for both RoomFacility and
        // CourseRequiredFacility — referenced rows block deletion.
        next(
          new ConflictError(
            'FACILITY_REFERENCED',
            'Cannot delete a facility referenced by rooms or courses',
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

export function createFacilitiesRouter(): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth(),
    validate({ query: listFacilitiesQuerySchema }),
    getList,
  );

  router.get(
    '/:id',
    requireAuth(),
    validate({ params: facilityIdParamsSchema }),
    getOne,
  );

  router.post(
    '/',
    requireAuth(),
    requireRole('admin'),
    validate({ body: createFacilityBodySchema }),
    postCreate,
  );

  router.patch(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: facilityIdParamsSchema, body: updateFacilityBodySchema }),
    patch,
  );

  router.delete(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: facilityIdParamsSchema }),
    remove,
  );

  return router;
}
