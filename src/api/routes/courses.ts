/**
 * `/courses` CRUD — admin + user (api_design §4.5, §5.3.6).
 *
 * Permission model:
 *   - GET / GET :id  — both roles.
 *   - POST           — both roles. No field-level admin gate (per §5.3.6,
 *                      `requiredCompetencies` is editable by both roles).
 *   - PATCH :id      — both roles.
 *   - DELETE :id     — admin only. 409 if referenced by any `CourseOffering`
 *                      (api_design §5.3.6 parallels Lecturer).
 *
 * `code` is unique per `(semesterId, code)` → 409 `COURSE_CODE_TAKEN` on
 * duplicate.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  courseIdParamsSchema,
  createCourseBodySchema,
  listCoursesQuerySchema,
  updateCourseBodySchema,
  type CreateCourseBody,
  type UpdateCourseBody,
} from '../schemas/courses';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { getCrudRepositories } from '../lib/crudContext';
import {
  isPrismaForeignKeyError,
  isPrismaNotFound,
  isPrismaUniqueViolation,
} from '../lib/prismaErrors';
import { buildListResponse } from '../lib/listResponse';
import { UnknownFacilityCodeError } from '../../repo/roomRepo';
import type { CourseRecord } from '../../repo/courseCrudRepo';

interface CourseWirePayload {
  id: number;
  semesterId: number;
  code: string;
  name: string;
  sks: number;
  requiredFacilities: string[];
  requiredCompetencies: string[];
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

function toWire(c: CourseRecord): CourseWirePayload {
  return {
    id: c.id,
    semesterId: c.semesterId,
    code: c.code,
    name: c.name,
    sks: c.sks,
    requiredFacilities: [...c.requiredFacilities],
    requiredCompetencies: [...c.requiredCompetencies],
    createdById: c.createdById,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
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

function unknownFacilityToValidation(err: UnknownFacilityCodeError): ValidationError {
  return new ValidationError(
    `Unknown facility code(s): ${err.codes.join(', ')}`,
    err.codes.map((c) => ({
      path: ['requiredFacilities'],
      message: `Unknown facility code: ${c}`,
      code: 'UNKNOWN_FACILITY',
    })),
    'UNKNOWN_FACILITY',
  );
}

async function getList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as ListQuery;
    const repos = getCrudRepositories();
    const opts: Parameters<typeof repos.courses.list>[0] = {
      filter: q.semesterId !== undefined ? { semesterId: q.semesterId } : {},
      page: q.page,
      pageSize: q.pageSize,
    };
    if (q.sort !== undefined) opts.sort = q.sort;
    const { rows, total } = await repos.courses.list(opts);
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
    const row = await repos.courses.findById(id);
    if (!row) {
      next(new NotFoundError('Course not found'));
      return;
    }
    res.status(200).json(toWire(row));
  } catch (err) {
    next(err);
  }
}

async function postCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as CreateCourseBody;
    const repos = getCrudRepositories();
    try {
      const created = await repos.courses.create({
        semesterId: body.semesterId,
        code: body.code,
        name: body.name,
        sks: body.sks,
        requiredFacilities: body.requiredFacilities,
        requiredCompetencies: body.requiredCompetencies,
        createdById: req.user?.id ?? null,
      });
      res.status(201).json(toWire(created));
    } catch (err) {
      const fac = unknownFacility(err);
      if (fac) {
        next(unknownFacilityToValidation(fac));
        return;
      }
      if (isPrismaUniqueViolation(err)) {
        next(
          new ConflictError(
            'COURSE_CODE_TAKEN',
            'Course code already exists for this semester',
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
    const body = req.body as UpdateCourseBody;
    const repos = getCrudRepositories();
    const existing = await repos.courses.findById(id);
    if (!existing) {
      next(new NotFoundError('Course not found'));
      return;
    }

    const patchInput: {
      code?: string;
      name?: string;
      sks?: number;
      requiredFacilities?: string[];
      requiredCompetencies?: string[];
    } = {};
    if (body.code !== undefined) patchInput.code = body.code;
    if (body.name !== undefined) patchInput.name = body.name;
    if (body.sks !== undefined) patchInput.sks = body.sks;
    if (body.requiredFacilities !== undefined) {
      patchInput.requiredFacilities = body.requiredFacilities;
    }
    if (body.requiredCompetencies !== undefined) {
      patchInput.requiredCompetencies = body.requiredCompetencies;
    }

    try {
      const updated = await repos.courses.update(id, patchInput);
      res.status(200).json(toWire(updated));
    } catch (err) {
      const fac = unknownFacility(err);
      if (fac) {
        next(unknownFacilityToValidation(fac));
        return;
      }
      if (isPrismaUniqueViolation(err)) {
        next(
          new ConflictError(
            'COURSE_CODE_TAKEN',
            'Course code already exists for this semester',
          ),
        );
        return;
      }
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Course not found'));
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
    const existing = await repos.courses.findById(id);
    if (!existing) {
      next(new NotFoundError('Course not found'));
      return;
    }
    if (await repos.courses.hasOfferingReferences(id)) {
      next(
        new ConflictError(
          'COURSE_REFERENCED',
          'Cannot delete a course referenced by any course offering',
        ),
      );
      return;
    }
    try {
      await repos.courses.delete(id);
      res.status(204).end();
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Course not found'));
        return;
      }
      if (isPrismaForeignKeyError(err)) {
        next(
          new ConflictError(
            'COURSE_REFERENCED',
            'Cannot delete a course referenced by any course offering',
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

export function createCoursesRouter(): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth(),
    validate({ query: listCoursesQuerySchema }),
    getList,
  );

  router.get(
    '/:id',
    requireAuth(),
    validate({ params: courseIdParamsSchema }),
    getOne,
  );

  router.post(
    '/',
    requireAuth(),
    validate({ body: createCourseBodySchema }),
    postCreate,
  );

  router.patch(
    '/:id',
    requireAuth(),
    validate({ params: courseIdParamsSchema, body: updateCourseBodySchema }),
    patch,
  );

  router.delete(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: courseIdParamsSchema }),
    remove,
  );

  return router;
}
