/**
 * `/course-offerings` CRUD — admin + user with field-level restrictions
 * (api_design §4.5, §4.6, §5.3.7).
 *
 * Permission model:
 *   - GET / GET :id                — both roles. Filterable by `courseId`,
 *                                    `roomId`, `lecturerId`,
 *                                    `parentOfferingId`.
 *   - POST                         — both roles. `user` cannot set `isFixed`
 *                                    or `fixedTimeSlotIds`; allowFields
 *                                    rejects them with 400 if present.
 *   - PATCH :id (full)             — admin only.
 *   - PATCH :id/student-count      — both roles. Narrow endpoint exists so
 *                                    `user` can update enrollment without
 *                                    inheriting full-edit privileges.
 *   - DELETE :id                   — admin only.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { allowFields } from '../middleware/permissions';
import {
  courseOfferingIdParamsSchema,
  createCourseOfferingBodySchema,
  listCourseOfferingsQuerySchema,
  updateCourseOfferingBodySchema,
  updateStudentCountBodySchema,
  type CreateCourseOfferingBody,
  type UpdateCourseOfferingBody,
  type UpdateStudentCountBody,
} from '../schemas/course-offerings';
import { ConflictError, NotFoundError, ValidationError, type ValidationIssue } from '../errors';
import { getCrudRepositories, type CrudRepositories } from '../lib/crudContext';
import { writeAudit } from '../lib/audit';
import { isPrismaForeignKeyError, isPrismaNotFound } from '../lib/prismaErrors';
import { buildListResponse } from '../lib/listResponse';
import type { CourseOfferingRecord } from '../../repo/courseOfferingRepo';

interface CourseOfferingWirePayload {
  id: number;
  semesterId: number;
  courseId: number;
  roomId: number | null;
  effectiveStudentCount: number;
  lecturerIds: number[];
  isFixed: boolean;
  fixedTimeSlotIds: number[];
  parentOfferingId: number | null;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

function toWire(o: CourseOfferingRecord): CourseOfferingWirePayload {
  return {
    id: o.id,
    semesterId: o.semesterId,
    courseId: o.courseId,
    roomId: o.roomId,
    effectiveStudentCount: o.effectiveStudentCount,
    lecturerIds: [...o.lecturerIds],
    isFixed: o.isFixed,
    fixedTimeSlotIds: [...o.fixedTimeSlotIds],
    parentOfferingId: o.parentOfferingId,
    createdById: o.createdById,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

interface ListQuery {
  page: number;
  pageSize: number;
  sort?: string;
  semesterId?: number;
  courseId?: number;
  roomId?: number;
  lecturerId?: number;
  parentOfferingId?: number;
}

interface IdParams {
  id: number;
}

// `user` POST allow-list per api_design §5.3.7. `isFixed` and
// `fixedTimeSlotIds` are admin-only — allowFields rejects them with 400
// when a `user` includes them. Admins bypass the gate.
const USER_CREATE_FIELDS = [
  'semesterId',
  'courseId',
  'roomId',
  'effectiveStudentCount',
  'lecturerIds',
  'parentOfferingId',
] as const;

function fkValidationError(): ValidationError {
  return new ValidationError(
    'Invalid reference (semesterId / courseId / roomId / lecturerIds / fixedTimeSlotIds / parentOfferingId)',
    [
      {
        path: [],
        message:
          'One of semesterId / courseId / roomId / lecturerIds / fixedTimeSlotIds / parentOfferingId references a missing row',
        code: 'INVALID_REFERENCE',
      },
    ],
    'INVALID_REFERENCE',
  );
}

// Phase 14 #4 — cross-semester reference guard. Loads the semesterId of every
// referenced entity in parallel and rejects any whose semester differs from
// `expectedSemesterId`. Missing rows are NOT this helper's concern — the
// existing P2003 path (fkValidationError) covers that. Multi-field mismatches
// are surfaced in a single envelope via `metadata.fields[]`; `metadata.field`
// duplicates `metadata.fields[0].field` so single-field consumers keep working.
type CrossSemesterField =
  | 'courseId'
  | 'lecturerIds'
  | 'roomId'
  | 'fixedTimeSlotIds'
  | 'parentOfferingId';

interface CrossSemesterMismatch {
  id: number;
  actualSemesterId: number;
}

interface CrossSemesterFieldGroup {
  field: CrossSemesterField;
  expectedSemesterId: number;
  mismatches: CrossSemesterMismatch[];
}

interface CrossSemesterCheckBody {
  courseId?: number;
  lecturerIds?: number[];
  roomId?: number | null;
  fixedTimeSlotIds?: number[];
  parentOfferingId?: number | null;
}

function describeCrossSemesterMismatch(group: CrossSemesterFieldGroup): string {
  const first = group.mismatches[0]!;
  return `${group.field} reference ${first.id} belongs to semester ${first.actualSemesterId} but offering is in semester ${group.expectedSemesterId}.`;
}

function crossSemesterError(groups: CrossSemesterFieldGroup[]): ValidationError {
  const primary = groups[0]!;
  const message = describeCrossSemesterMismatch(primary);
  const issues: ValidationIssue[] = groups.map((g) => ({
    path: [g.field],
    message: describeCrossSemesterMismatch(g),
    code: 'CROSS_SEMESTER_REFERENCE',
  }));
  return new ValidationError(message, issues, 'CROSS_SEMESTER_REFERENCE', {
    field: primary.field,
    expectedSemesterId: primary.expectedSemesterId,
    mismatches: primary.mismatches,
    fields: groups,
  });
}

async function assertSameSemester(
  expectedSemesterId: number,
  body: CrossSemesterCheckBody,
  repos: CrudRepositories,
): Promise<void> {
  const lecturerIds = body.lecturerIds ?? [];
  const fixedTimeSlotIds = body.fixedTimeSlotIds ?? [];
  const checkCourse = body.courseId !== undefined;
  const checkRoom = body.roomId !== undefined && body.roomId !== null;
  const checkParent =
    body.parentOfferingId !== undefined && body.parentOfferingId !== null;

  const [coursePromise, roomPromise, parentPromise, lecturers, slots] =
    await Promise.all([
      checkCourse ? repos.courses.findById(body.courseId as number) : Promise.resolve(null),
      checkRoom ? repos.rooms.findById(body.roomId as number) : Promise.resolve(null),
      checkParent
        ? repos.courseOfferings.findById(body.parentOfferingId as number)
        : Promise.resolve(null),
      Promise.all(lecturerIds.map((id) => repos.lecturers.findById(id))),
      Promise.all(fixedTimeSlotIds.map((id) => repos.timeSlots.findById(id))),
    ]);

  const groups: CrossSemesterFieldGroup[] = [];

  if (checkCourse && coursePromise && coursePromise.semesterId !== expectedSemesterId) {
    groups.push({
      field: 'courseId',
      expectedSemesterId,
      mismatches: [{ id: coursePromise.id, actualSemesterId: coursePromise.semesterId }],
    });
  }
  if (checkRoom && roomPromise && roomPromise.semesterId !== expectedSemesterId) {
    groups.push({
      field: 'roomId',
      expectedSemesterId,
      mismatches: [{ id: roomPromise.id, actualSemesterId: roomPromise.semesterId }],
    });
  }
  if (checkParent && parentPromise && parentPromise.semesterId !== expectedSemesterId) {
    groups.push({
      field: 'parentOfferingId',
      expectedSemesterId,
      mismatches: [
        { id: parentPromise.id, actualSemesterId: parentPromise.semesterId },
      ],
    });
  }

  const lecturerMismatches: CrossSemesterMismatch[] = [];
  lecturers.forEach((row, idx) => {
    if (row && row.semesterId !== expectedSemesterId) {
      lecturerMismatches.push({
        id: lecturerIds[idx]!,
        actualSemesterId: row.semesterId,
      });
    }
  });
  if (lecturerMismatches.length > 0) {
    groups.push({
      field: 'lecturerIds',
      expectedSemesterId,
      mismatches: lecturerMismatches,
    });
  }

  const slotMismatches: CrossSemesterMismatch[] = [];
  slots.forEach((row, idx) => {
    if (row && row.semesterId !== expectedSemesterId) {
      slotMismatches.push({
        id: fixedTimeSlotIds[idx]!,
        actualSemesterId: row.semesterId,
      });
    }
  });
  if (slotMismatches.length > 0) {
    groups.push({
      field: 'fixedTimeSlotIds',
      expectedSemesterId,
      mismatches: slotMismatches,
    });
  }

  if (groups.length > 0) {
    throw crossSemesterError(groups);
  }
}

async function getList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as ListQuery;
    const repos = getCrudRepositories();
    const filter: {
      semesterId?: number;
      courseId?: number;
      roomId?: number;
      lecturerId?: number;
      parentOfferingId?: number;
    } = {};
    if (q.semesterId !== undefined) filter.semesterId = q.semesterId;
    if (q.courseId !== undefined) filter.courseId = q.courseId;
    if (q.roomId !== undefined) filter.roomId = q.roomId;
    if (q.lecturerId !== undefined) filter.lecturerId = q.lecturerId;
    if (q.parentOfferingId !== undefined) filter.parentOfferingId = q.parentOfferingId;
    const opts: Parameters<typeof repos.courseOfferings.list>[0] = {
      filter,
      page: q.page,
      pageSize: q.pageSize,
    };
    if (q.sort !== undefined) opts.sort = q.sort;
    const { rows, total } = await repos.courseOfferings.list(opts);
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
    const row = await repos.courseOfferings.findById(id);
    if (!row) {
      next(new NotFoundError('Course offering not found'));
      return;
    }
    res.status(200).json(toWire(row));
  } catch (err) {
    next(err);
  }
}

async function postCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as CreateCourseOfferingBody;
    const repos = getCrudRepositories();
    // §5.3.7: `user` cannot set `isFixed` / `fixedTimeSlotIds`. allowFields
    // already rejected those fields if present in a user body; for user we
    // additionally force the server defaults so the data stays consistent.
    const isAdmin = req.user?.role === 'admin';
    const isFixed = isAdmin ? body.isFixed ?? false : false;
    const fixedTimeSlotIds = isAdmin ? body.fixedTimeSlotIds ?? [] : [];
    await assertSameSemester(
      body.semesterId,
      {
        courseId: body.courseId,
        lecturerIds: body.lecturerIds,
        roomId: body.roomId ?? null,
        fixedTimeSlotIds,
        parentOfferingId: body.parentOfferingId ?? null,
      },
      repos,
    );
    try {
      const created = await repos.courseOfferings.create({
        semesterId: body.semesterId,
        courseId: body.courseId,
        roomId: body.roomId ?? null,
        effectiveStudentCount: body.effectiveStudentCount,
        lecturerIds: body.lecturerIds,
        isFixed,
        fixedTimeSlotIds,
        parentOfferingId: body.parentOfferingId ?? null,
        createdById: req.user?.id ?? null,
      });
      await writeAudit(req, {
        action: 'course_offering.create',
        entityType: 'CourseOffering',
        entityId: String(created.id),
        metadata: {
          before: null,
          after: created,
          role: req.user?.role ?? null,
        },
      });
      res.status(201).json(toWire(created));
    } catch (err) {
      if (isPrismaForeignKeyError(err)) {
        next(fkValidationError());
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
    const body = req.body as UpdateCourseOfferingBody;
    const repos = getCrudRepositories();
    const existing = await repos.courseOfferings.findById(id);
    if (!existing) {
      next(new NotFoundError('Course offering not found'));
      return;
    }

    // Phase 14 #4 — PATCH validates only fields present on the body against
    // the existing offering's semester. Absent fields are unchanged.
    const crossCheckBody: CrossSemesterCheckBody = {};
    if (body.courseId !== undefined) crossCheckBody.courseId = body.courseId;
    if (body.lecturerIds !== undefined) crossCheckBody.lecturerIds = body.lecturerIds;
    if (body.roomId !== undefined) crossCheckBody.roomId = body.roomId;
    if (body.fixedTimeSlotIds !== undefined) {
      crossCheckBody.fixedTimeSlotIds = body.fixedTimeSlotIds;
    }
    if (body.parentOfferingId !== undefined) {
      crossCheckBody.parentOfferingId = body.parentOfferingId;
    }
    await assertSameSemester(existing.semesterId, crossCheckBody, repos);

    const patchInput: {
      courseId?: number;
      roomId?: number | null;
      effectiveStudentCount?: number;
      lecturerIds?: number[];
      isFixed?: boolean;
      fixedTimeSlotIds?: number[];
      parentOfferingId?: number | null;
    } = {};
    if (body.courseId !== undefined) patchInput.courseId = body.courseId;
    if (body.roomId !== undefined) patchInput.roomId = body.roomId;
    if (body.effectiveStudentCount !== undefined) {
      patchInput.effectiveStudentCount = body.effectiveStudentCount;
    }
    if (body.lecturerIds !== undefined) patchInput.lecturerIds = body.lecturerIds;
    if (body.isFixed !== undefined) patchInput.isFixed = body.isFixed;
    if (body.fixedTimeSlotIds !== undefined) {
      patchInput.fixedTimeSlotIds = body.fixedTimeSlotIds;
    }
    if (body.parentOfferingId !== undefined) {
      patchInput.parentOfferingId = body.parentOfferingId;
    }

    try {
      const updated = await repos.courseOfferings.update(id, patchInput);
      await writeAudit(req, {
        action: 'course_offering.update',
        entityType: 'CourseOffering',
        entityId: String(id),
        metadata: {
          before: existing,
          after: updated,
          role: req.user?.role ?? null,
        },
      });
      res.status(200).json(toWire(updated));
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Course offering not found'));
        return;
      }
      if (isPrismaForeignKeyError(err)) {
        next(fkValidationError());
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

async function patchStudentCount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params as unknown as IdParams;
    const body = req.body as UpdateStudentCountBody;
    const repos = getCrudRepositories();
    const existing = await repos.courseOfferings.findById(id);
    if (!existing) {
      next(new NotFoundError('Course offering not found'));
      return;
    }
    try {
      const updated = await repos.courseOfferings.updateStudentCount(
        id,
        body.effectiveStudentCount,
      );
      // Narrow student-count update — still a `course_offering.update` per
      // §8 (the action table groups all CourseOffering edits under the same
      // code). `op` annotates which sub-endpoint produced the row.
      await writeAudit(req, {
        action: 'course_offering.update',
        entityType: 'CourseOffering',
        entityId: String(id),
        metadata: {
          before: existing,
          after: updated,
          role: req.user?.role ?? null,
          op: 'student-count',
        },
      });
      res.status(200).json(toWire(updated));
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Course offering not found'));
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

function offeringReferencedByRunError(runIds: string[]): ConflictError {
  return new ConflictError(
    'OFFERING_REFERENCED_BY_RUN',
    `This offering appears in ${runIds.length} schedule run(s). Delete those run(s) first.`,
    { runIds },
  );
}

async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params as unknown as IdParams;
    const repos = getCrudRepositories();
    const existing = await repos.courseOfferings.findById(id);
    if (!existing) {
      next(new NotFoundError('Course offering not found'));
      return;
    }

    // Proactive FK gate: surface an actionable 409 listing the pinning runs
    // before Prisma raises a generic P2003 (Phase 9 Task 1).
    const { runIds } = await repos.scheduleRuns.countAssignmentsByOfferingId(id);
    if (runIds.length > 0) {
      next(offeringReferencedByRunError(runIds));
      return;
    }

    try {
      await repos.courseOfferings.delete(id);
      await writeAudit(req, {
        action: 'course_offering.delete',
        entityType: 'CourseOffering',
        entityId: String(id),
        metadata: {
          before: existing,
          after: null,
          role: req.user?.role ?? null,
        },
      });
      res.status(204).end();
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError('Course offering not found'));
        return;
      }
      if (isPrismaForeignKeyError(err)) {
        // Race: a run was created between the proactive check and the delete.
        const recheck = await repos.scheduleRuns.countAssignmentsByOfferingId(id);
        next(offeringReferencedByRunError(recheck.runIds));
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

export function createCourseOfferingsRouter(): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth(),
    validate({ query: listCourseOfferingsQuerySchema }),
    getList,
  );

  router.get(
    '/:id',
    requireAuth(),
    validate({ params: courseOfferingIdParamsSchema }),
    getOne,
  );

  router.post(
    '/',
    requireAuth(),
    allowFields(USER_CREATE_FIELDS),
    validate({ body: createCourseOfferingBodySchema }),
    postCreate,
  );

  router.patch(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({
      params: courseOfferingIdParamsSchema,
      body: updateCourseOfferingBodySchema,
    }),
    patch,
  );

  router.patch(
    '/:id/student-count',
    requireAuth(),
    validate({
      params: courseOfferingIdParamsSchema,
      body: updateStudentCountBodySchema,
    }),
    patchStudentCount,
  );

  router.delete(
    '/:id',
    requireAuth(),
    requireRole('admin'),
    validate({ params: courseOfferingIdParamsSchema }),
    remove,
  );

  return router;
}
