/**
 * `/lecturers` CRUD — admin + user with field-level restrictions
 * (api_design §4.5, §4.6, §5.3.5).
 *
 * Permission model:
 *   - GET / GET :id        — both roles.
 *   - POST                 — both roles. `user` cannot set `isStructural`
 *                            (server forces `false`); allowFields rejects the
 *                            field with 400 `FIELD_NOT_ALLOWED`.
 *   - PATCH :id            — both roles. `user` cannot change `isStructural`.
 *   - DELETE :id           — admin only. 409 if referenced by any
 *                            `CourseOfferingLecturer` (api_design §5.3.5).
 *
 * Both `admin` and `user` may edit `competencies` (api_design §5.3.5 note).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { allowFields } from '../middleware/permissions';
import {
  createLecturerBodySchema,
  lecturerIdParamsSchema,
  listLecturersQuerySchema,
  updateLecturerBodySchema,
  type CreateLecturerBody,
  type UpdateLecturerBody,
} from '../schemas/lecturers';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { getCrudRepositories } from '../lib/crudContext';
import { isPrismaForeignKeyError, isPrismaNotFound } from '../lib/prismaErrors';
import { buildListResponse } from '../lib/listResponse';
import type { LecturerRecord } from '../../repo/lecturerCrudRepo';

interface LecturerWirePayload {
  id: number;
  semesterId: number;
  name: string;
  isStructural: boolean;
  preferredTimeSlotIds: number[];
  competencies: string[];
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

function toWire(l: LecturerRecord): LecturerWirePayload {
  return {
    id: l.id,
    semesterId: l.semesterId,
    name: l.name,
    isStructural: l.isStructural,
    preferredTimeSlotIds: [...l.preferredTimeSlotIds],
    competencies: [...l.competencies],
    createdById: l.createdById,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

interface ListQuery {
  page: number;
  pageSize: number;
  sort?: string;
  semesterId?: number;
  isStructural?: boolean;
}

interface IdParams {
  id: number;
}

// Field allow-lists for `user` callers (api_design §4.5 / §5.3.5). `admin`
// bypasses entirely.
const USER_CREATE_FIELDS = [
  'semesterId',
  'name',
  'preferredTimeSlotIds',
  'competencies',
] as const;
const USER_UPDATE_FIELDS = [
  'name',
  'preferredTimeSlotIds',
  'competencies',
] as const;

async function getList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as ListQuery;
    const repos = getCrudRepositories();
    const filter: { semesterId?: number; isStructural?: boolean } = {};
    if (q.semesterId !== undefined) filter.semesterId = q.semesterId;
    if (q.isStructural !== undefined) filter.isStructural = q.isStructural;
    const opts: Parameters<typeof repos.lecturers.list>[0] = {
      filter,
      page: q.page,
      pageSize: q.pageSize,
    };
    if (q.sort !== undefined) opts.sort = q.sort;
    const { rows, total } = await repos.lecturers.list(opts);
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
    const row = await repos.lecturers.findById(id);
    if (!row) {
      next(new NotFoundError('Lecturer not found'));
      return;
    }
    res.status(200).json(toWire(row));
  } catch (err) {
    next(err);
  }
}

async function postCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as CreateLecturerBody;
    const repos = getCrudRepositories();
    // §5.3.5: `user` cannot set `isStructural`. allowFields already rejected
    // the field if present in a user body; defensively force `false` here for
    // user, leave admin's choice intact.
    const isStructural =
      req.user?.role === 'admin' ? body.isStructural ?? false : false;
    try {
      const created = await repos.lecturers.create({
        semesterId: body.semesterId,
        name: body.name,
        isStructural,
        preferredTimeSlotIds: body.preferredTimeSlotIds,
        competencies: body.competencies,
        createdById: req.user?.id ?? null,
      });
      res.status(201).json(toWire(created));
    } catch (err) {
      if (isPrismaForeignKeyError(err)) {
        next(
          new ValidationError(
            'Invalid semesterId or preferredTimeSlotIds reference',
            [
              {
                path: [],
                message:
                  'semesterId or one of preferredTimeSlotIds references a missing row',
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
    const body = req.body as UpdateLecturerBody;
    const repos = getCrudRepositories();
    const existing = await repos.lecturers.findById(id);
    if (!existing) {
      next(new NotFoundError('Lecturer not found'));
      return;
    }

    const patchInput: {
      name?: string;
      isStructural?: boolean;
      preferredTimeSlotIds?: number[];
      competencies?: string[];
    } = {};
    if (body.name !== undefined) patchInput.name = body.name;
    if (body.preferredTimeSlotIds !== undefined) {
      patchInput.preferredTimeSlotIds = body.preferredTimeSlotIds;
    }
    if (body.competencies !== undefined) patchInput.competencies = body.competencies;
    if (body.isStructural !== undefined && req.user?.role === 'admin') {
      patchInput.isStructural = body.isStructural;
    }
    // For `user`, allowFields already rejected `isStructural` upstream.

    try {
      const updated = await repos.lecturers.update(id, patchInput);
      res.status(200).json(toWire(updated));
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Lecturer not found'));
        return;
      }
      if (isPrismaForeignKeyError(err)) {
        next(
          new ValidationError(
            'Invalid preferredTimeSlotIds reference',
            [
              {
                path: ['preferredTimeSlotIds'],
                message: 'One of preferredTimeSlotIds references a missing row',
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

async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params as unknown as IdParams;
    const repos = getCrudRepositories();
    const existing = await repos.lecturers.findById(id);
    if (!existing) {
      next(new NotFoundError('Lecturer not found'));
      return;
    }
    if (await repos.lecturers.hasOfferingReferences(id)) {
      next(
        new ConflictError(
          'LECTURER_REFERENCED',
          'Cannot delete a lecturer referenced by any course offering',
        ),
      );
      return;
    }
    try {
      await repos.lecturers.delete(id);
      res.status(204).end();
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Lecturer not found'));
        return;
      }
      if (isPrismaForeignKeyError(err)) {
        // Race: a reference appeared between the check and the delete.
        next(
          new ConflictError(
            'LECTURER_REFERENCED',
            'Cannot delete a lecturer referenced by any course offering',
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

export function createLecturersRouter(): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth(),
    validate({ query: listLecturersQuerySchema }),
    getList,
  );

  router.get(
    '/:id',
    requireAuth(),
    validate({ params: lecturerIdParamsSchema }),
    getOne,
  );

  router.post(
    '/',
    requireAuth(),
    allowFields(USER_CREATE_FIELDS),
    validate({ body: createLecturerBodySchema }),
    postCreate,
  );

  router.patch(
    '/:id',
    requireAuth(),
    allowFields(USER_UPDATE_FIELDS),
    validate({ params: lecturerIdParamsSchema, body: updateLecturerBodySchema }),
    patch,
  );

  router.delete(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: lecturerIdParamsSchema }),
    remove,
  );

  return router;
}
