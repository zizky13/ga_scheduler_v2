/**
 * `/semesters` CRUD — admin write, user read (api_design §4.5, §5.3.3).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  activateSemesterBodySchema,
  createSemesterBodySchema,
  listSemestersQuerySchema,
  semesterIdParamsSchema,
  updateSemesterBodySchema,
  type CreateSemesterBody,
  type UpdateSemesterBody,
} from '../schemas/semesters';
import { ConflictError, NotFoundError } from '../errors';
import { getCrudRepositories } from '../lib/crudContext';
import { writeAudit } from '../lib/audit';
import { isPrismaNotFound, isPrismaUniqueViolation } from '../lib/prismaErrors';
import { buildListResponse } from '../lib/listResponse';
import type { SemesterRecord } from '../../repo/semesterRepo';

interface SemesterWirePayload {
  id: number;
  code: string;
  label: string;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function toWire(s: SemesterRecord): SemesterWirePayload {
  return {
    id: s.id,
    code: s.code,
    label: s.label,
    startsOn: s.startsOn.toISOString(),
    endsOn: s.endsOn.toISOString(),
    isActive: s.isActive,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

interface ListQuery {
  page: number;
  pageSize: number;
  sort?: string;
  isActive?: boolean;
}

interface IdParams {
  id: number;
}

async function getList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as ListQuery;
    const repos = getCrudRepositories();
    const opts: Parameters<typeof repos.semesters.list>[0] = {
      filter: q.isActive !== undefined ? { isActive: q.isActive } : {},
      page: q.page,
      pageSize: q.pageSize,
    };
    if (q.sort !== undefined) opts.sort = q.sort;
    const { rows, total } = await repos.semesters.list(opts);
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
    const row = await repos.semesters.findById(id);
    if (!row) {
      next(new NotFoundError('Semester not found'));
      return;
    }
    res.status(200).json(toWire(row));
  } catch (err) {
    next(err);
  }
}

async function postCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as CreateSemesterBody;
    const repos = getCrudRepositories();
    try {
      const created = await repos.semesters.create({
        code: body.code,
        label: body.label,
        startsOn: new Date(body.startsOn),
        endsOn: new Date(body.endsOn),
      });
      await writeAudit(req, {
        action: 'semester.create',
        entityType: 'Semester',
        entityId: String(created.id),
        metadata: { before: null, after: created },
      });
      res.status(201).json(toWire(created));
    } catch (err) {
      if (isPrismaUniqueViolation(err)) {
        next(new ConflictError('SEMESTER_CODE_TAKEN', 'Semester code already in use'));
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
    const body = req.body as UpdateSemesterBody;
    const repos = getCrudRepositories();
    const before = await repos.semesters.findById(id);
    if (!before) {
      next(new NotFoundError('Semester not found'));
      return;
    }
    const patchInput: { label?: string; startsOn?: Date; endsOn?: Date } = {};
    if (body.label !== undefined) patchInput.label = body.label;
    if (body.startsOn !== undefined) patchInput.startsOn = new Date(body.startsOn);
    if (body.endsOn !== undefined) patchInput.endsOn = new Date(body.endsOn);

    try {
      const updated = await repos.semesters.update(id, patchInput);
      await writeAudit(req, {
        action: 'semester.update',
        entityType: 'Semester',
        entityId: String(id),
        metadata: { before, after: updated },
      });
      res.status(200).json(toWire(updated));
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Semester not found'));
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

async function activate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params as unknown as IdParams;
    const repos = getCrudRepositories();
    const existing = await repos.semesters.findById(id);
    if (!existing) {
      next(new NotFoundError('Semester not found'));
      return;
    }
    const activated = await repos.semesters.activate(id);
    // §8 lumps activate under `semester.*` — emit a `semester.update`-shape
    // diff so the audit log captures the isActive flip plus any siblings that
    // were deactivated as part of the operation.
    await writeAudit(req, {
      action: 'semester.update',
      entityType: 'Semester',
      entityId: String(id),
      metadata: { before: existing, after: activated, op: 'activate' },
    });
    res.status(200).json(toWire(activated));
  } catch (err) {
    next(err);
  }
}

async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params as unknown as IdParams;
    const repos = getCrudRepositories();
    const existing = await repos.semesters.findById(id);
    if (!existing) {
      next(new NotFoundError('Semester not found'));
      return;
    }
    if (existing.isActive) {
      next(new ConflictError('SEMESTER_ACTIVE', 'Cannot delete an active semester'));
      return;
    }
    if (await repos.semesters.hasRelatedRows(id)) {
      next(
        new ConflictError(
          'SEMESTER_HAS_RELATED_ROWS',
          'Cannot delete a semester with related rooms / time slots / lecturers / courses / offerings / locked rooms / runs',
        ),
      );
      return;
    }
    await repos.semesters.delete(id);
    await writeAudit(req, {
      action: 'semester.delete',
      entityType: 'Semester',
      entityId: String(id),
      metadata: { before: existing, after: null },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export function createSemestersRouter(): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth(),
    validate({ query: listSemestersQuerySchema }),
    getList,
  );

  router.get(
    '/:id',
    requireAuth(),
    validate({ params: semesterIdParamsSchema }),
    getOne,
  );

  router.post(
    '/',
    requireAuth(),
    requireRole('admin'),
    validate({ body: createSemesterBodySchema }),
    postCreate,
  );

  router.patch(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: semesterIdParamsSchema, body: updateSemesterBodySchema }),
    patch,
  );

  router.post(
    '/:id/activate',
    requireAuth(),
    requireRole('admin'),
    validate({ params: semesterIdParamsSchema, body: activateSemesterBodySchema }),
    activate,
  );

  router.delete(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: semesterIdParamsSchema }),
    remove,
  );

  return router;
}
