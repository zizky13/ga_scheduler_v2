/**
 * Centralized OpenAPI path registrations. Reads the existing zod schemas from
 * `src/api/schemas/*` (the source of truth for runtime validation) and emits
 * route metadata declaratively — keeping the route handler files free of
 * documentation concerns.
 *
 * The list of paths registered here mirrors every `router.<method>(...)` call
 * across `src/api/routes/*` (verified by reading the source). Add a new entry
 * here whenever a new route is mounted.
 */

// MUST stay first — `./components` calls `.openapi(...)` at module load.
import './zod-init';

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { bearerSecurity, pickErrorResponses } from './components';

// ─── Schema imports (source of truth) ──────────────────────────────────────

import { loginBodySchema, registerBodySchema } from '../schemas/auth';
// `refreshBodySchema` and `logoutBodySchema` are `.optional()` zero-key bodies;
// for OpenAPI we describe them as concrete empty objects via `emptyBodySchema`.
import {
  listUsersQuerySchema,
  updateUserBodySchema,
  userIdParamsSchema,
} from '../schemas/users';
import {
  createSemesterBodySchema,
  listSemestersQuerySchema,
  semesterIdParamsSchema,
  updateSemesterBodySchema,
} from '../schemas/semesters';
// `activateSemesterBodySchema` is `.optional()`; described via `emptyBodySchema`.
import {
  createRoomBodySchema,
  listRoomsQuerySchema,
  roomIdParamsSchema,
  updateRoomBodySchema,
} from '../schemas/rooms';
import {
  createTimeslotBodySchema,
  listTimeslotsQuerySchema,
  timeslotIdParamsSchema,
  updateTimeslotBodySchema,
} from '../schemas/timeslots';
import {
  createFacilityBodySchema,
  facilityIdParamsSchema,
  listFacilitiesQuerySchema,
  updateFacilityBodySchema,
} from '../schemas/facilities';
import {
  createLockedRoomBodySchema,
  listLockedRoomsQuerySchema,
  lockedRoomIdParamsSchema,
  updateLockedRoomBodySchema,
} from '../schemas/locked-rooms';
import {
  createLecturerBodySchema,
  lecturerIdParamsSchema,
  listLecturersQuerySchema,
  updateLecturerBodySchema,
} from '../schemas/lecturers';
import {
  courseIdParamsSchema,
  createCourseBodySchema,
  listCoursesQuerySchema,
  updateCourseBodySchema,
} from '../schemas/courses';
import {
  courseOfferingIdParamsSchema,
  createCourseOfferingBodySchema,
  listCourseOfferingsQuerySchema,
  updateCourseOfferingBodySchema,
  updateStudentCountBodySchema,
} from '../schemas/course-offerings';
import {
  createScheduleRunBodySchema,
  listScheduleRunsQuerySchema,
  overrideAssignmentBodySchema,
  scheduleRunDetailResponseSchema,
  scheduleRunAssignmentParamsSchema,
  scheduleRunIdParamsSchema,
  scheduleRunStreamParamsSchema,
} from '../schemas/schedule-runs';
// `cancelScheduleRunBodySchema` is `.optional()`; described via `emptyBodySchema`.

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Wrap a body schema as a JSON request body. */
function jsonBody(schema: z.ZodTypeAny, description?: string) {
  const body: { description?: string; required: boolean; content: Record<string, { schema: z.ZodTypeAny }> } = {
    required: true,
    content: { 'application/json': { schema } },
  };
  if (description !== undefined) body.description = description;
  return body;
}

/**
 * Some body schemas are `.optional()` (e.g. logout, refresh, cancel). zod-to-openapi
 * needs a concrete object; treat those as zero-key bodies so the spec is honest
 * about "no fields".
 */
const emptyBodySchema = z.object({}).strict();

/** Standard "success" response wrapper that just describes the status. */
function ok(description: string) {
  return {
    description,
    content: { 'application/json': { schema: z.unknown() } },
  };
}

function okJson(description: string, schema: z.ZodTypeAny) {
  return {
    description,
    content: { 'application/json': { schema } },
  };
}

function noContent(description: string) {
  return { description };
}

// ─── Registration ──────────────────────────────────────────────────────────

export function registerPaths(registry: OpenAPIRegistry): void {
  // ── /auth ────────────────────────────────────────────────────────────────
  // POST /auth/register — admin-only (requireAuth + requireRole('admin'))
  registry.registerPath({
    method: 'post',
    path: '/auth/register',
    tags: ['auth'],
    summary: 'Create a new user (admin only).',
    security: bearerSecurity,
    request: { body: jsonBody(registerBodySchema) },
    responses: {
      201: ok('User created.'),
      ...pickErrorResponses(401, 403, 409),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/auth/login',
    tags: ['auth'],
    summary: 'Exchange email + password for an access token.',
    request: { body: jsonBody(loginBodySchema) },
    responses: {
      200: ok('Access token issued; refresh-token cookie set.'),
      ...pickErrorResponses(401, 403),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/auth/refresh',
    tags: ['auth'],
    summary:
      'Rotate the refresh-token cookie and issue a new access token. Requires the HttpOnly refresh cookie.',
    request: { body: jsonBody(emptyBodySchema) },
    responses: {
      200: ok('New access token issued; refresh-token cookie rotated.'),
      ...pickErrorResponses(401),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/auth/logout',
    tags: ['auth'],
    summary: 'Revoke the current refresh token and clear the cookie.',
    security: bearerSecurity,
    request: { body: jsonBody(emptyBodySchema) },
    responses: {
      204: noContent('Logout succeeded (idempotent).'),
      ...pickErrorResponses(401),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/auth/me',
    tags: ['auth'],
    summary: 'Return the authenticated user.',
    security: bearerSecurity,
    responses: {
      200: ok('Authenticated user payload.'),
      ...pickErrorResponses(401, 404),
    },
  });

  // ── /users ───────────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/users',
    tags: ['users'],
    summary: 'List users (admin only).',
    security: bearerSecurity,
    request: { query: listUsersQuerySchema },
    responses: {
      200: ok('Paged user list.'),
      ...pickErrorResponses(401, 403),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/users/{id}',
    tags: ['users'],
    summary: 'Fetch a single user (admin only).',
    security: bearerSecurity,
    request: { params: userIdParamsSchema },
    responses: {
      200: ok('User payload.'),
      ...pickErrorResponses(401, 403, 404),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/users/{id}',
    tags: ['users'],
    summary: 'Update a user (admin only).',
    security: bearerSecurity,
    request: { params: userIdParamsSchema, body: jsonBody(updateUserBodySchema) },
    responses: {
      200: ok('Updated user payload.'),
      ...pickErrorResponses(401, 403, 404),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/users/{id}',
    tags: ['users'],
    summary: 'Soft-deactivate a user (admin only).',
    security: bearerSecurity,
    request: { params: userIdParamsSchema },
    responses: {
      204: noContent('User deactivated.'),
      ...pickErrorResponses(401, 403, 404, 409),
    },
  });

  // ── /semesters ───────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/semesters',
    tags: ['semesters'],
    summary: 'List semesters.',
    security: bearerSecurity,
    request: { query: listSemestersQuerySchema },
    responses: { 200: ok('Paged semester list.'), ...pickErrorResponses(401) },
  });

  registry.registerPath({
    method: 'get',
    path: '/semesters/{id}',
    tags: ['semesters'],
    summary: 'Fetch a single semester.',
    security: bearerSecurity,
    request: { params: semesterIdParamsSchema },
    responses: { 200: ok('Semester payload.'), ...pickErrorResponses(401, 404) },
  });

  registry.registerPath({
    method: 'post',
    path: '/semesters',
    tags: ['semesters'],
    summary: 'Create a semester (admin only).',
    security: bearerSecurity,
    request: { body: jsonBody(createSemesterBodySchema) },
    responses: { 201: ok('Created semester.'), ...pickErrorResponses(401, 403, 409) },
  });

  registry.registerPath({
    method: 'patch',
    path: '/semesters/{id}',
    tags: ['semesters'],
    summary: 'Update a semester (admin only).',
    security: bearerSecurity,
    request: { params: semesterIdParamsSchema, body: jsonBody(updateSemesterBodySchema) },
    responses: { 200: ok('Updated semester.'), ...pickErrorResponses(401, 403, 404) },
  });

  registry.registerPath({
    method: 'post',
    path: '/semesters/{id}/activate',
    tags: ['semesters'],
    summary: 'Mark a semester active (admin only). Deactivates siblings.',
    security: bearerSecurity,
    request: {
      params: semesterIdParamsSchema,
      body: jsonBody(emptyBodySchema),
    },
    responses: { 200: ok('Activated semester.'), ...pickErrorResponses(401, 403, 404) },
  });

  registry.registerPath({
    method: 'delete',
    path: '/semesters/{id}',
    tags: ['semesters'],
    summary: 'Delete an inactive, unreferenced semester (admin only).',
    security: bearerSecurity,
    request: { params: semesterIdParamsSchema },
    responses: { 204: noContent('Deleted.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  // ── /rooms ───────────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/rooms',
    tags: ['rooms'],
    summary: 'List rooms.',
    security: bearerSecurity,
    request: { query: listRoomsQuerySchema },
    responses: { 200: ok('Paged room list.'), ...pickErrorResponses(401) },
  });

  registry.registerPath({
    method: 'get',
    path: '/rooms/{id}',
    tags: ['rooms'],
    summary: 'Fetch a room.',
    security: bearerSecurity,
    request: { params: roomIdParamsSchema },
    responses: { 200: ok('Room payload.'), ...pickErrorResponses(401, 404) },
  });

  registry.registerPath({
    method: 'post',
    path: '/rooms',
    tags: ['rooms'],
    summary: 'Create a room (admin only).',
    security: bearerSecurity,
    request: { body: jsonBody(createRoomBodySchema) },
    responses: { 201: ok('Created room.'), ...pickErrorResponses(401, 403, 409) },
  });

  registry.registerPath({
    method: 'patch',
    path: '/rooms/{id}',
    tags: ['rooms'],
    summary: 'Update a room (admin only).',
    security: bearerSecurity,
    request: { params: roomIdParamsSchema, body: jsonBody(updateRoomBodySchema) },
    responses: { 200: ok('Updated room.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  registry.registerPath({
    method: 'delete',
    path: '/rooms/{id}',
    tags: ['rooms'],
    summary: 'Delete a room (admin only).',
    security: bearerSecurity,
    request: { params: roomIdParamsSchema },
    responses: { 204: noContent('Deleted.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  // ── /timeslots ───────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/timeslots',
    tags: ['timeslots'],
    summary: 'List timeslots.',
    security: bearerSecurity,
    request: { query: listTimeslotsQuerySchema },
    responses: { 200: ok('Paged timeslot list.'), ...pickErrorResponses(401) },
  });

  registry.registerPath({
    method: 'get',
    path: '/timeslots/{id}',
    tags: ['timeslots'],
    summary: 'Fetch a timeslot.',
    security: bearerSecurity,
    request: { params: timeslotIdParamsSchema },
    responses: { 200: ok('Timeslot payload.'), ...pickErrorResponses(401, 404) },
  });

  registry.registerPath({
    method: 'post',
    path: '/timeslots',
    tags: ['timeslots'],
    summary: 'Create a timeslot (admin only).',
    security: bearerSecurity,
    request: { body: jsonBody(createTimeslotBodySchema) },
    responses: { 201: ok('Created timeslot.'), ...pickErrorResponses(401, 403, 409) },
  });

  registry.registerPath({
    method: 'patch',
    path: '/timeslots/{id}',
    tags: ['timeslots'],
    summary: 'Update a timeslot (admin only).',
    security: bearerSecurity,
    request: { params: timeslotIdParamsSchema, body: jsonBody(updateTimeslotBodySchema) },
    responses: { 200: ok('Updated timeslot.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  registry.registerPath({
    method: 'delete',
    path: '/timeslots/{id}',
    tags: ['timeslots'],
    summary: 'Delete a timeslot (admin only).',
    security: bearerSecurity,
    request: { params: timeslotIdParamsSchema },
    responses: { 204: noContent('Deleted.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  // ── /facilities ──────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/facilities',
    tags: ['facilities'],
    summary: 'List facilities.',
    security: bearerSecurity,
    request: { query: listFacilitiesQuerySchema },
    responses: { 200: ok('Paged facility list.'), ...pickErrorResponses(401) },
  });

  registry.registerPath({
    method: 'get',
    path: '/facilities/{id}',
    tags: ['facilities'],
    summary: 'Fetch a facility.',
    security: bearerSecurity,
    request: { params: facilityIdParamsSchema },
    responses: { 200: ok('Facility payload.'), ...pickErrorResponses(401, 404) },
  });

  registry.registerPath({
    method: 'post',
    path: '/facilities',
    tags: ['facilities'],
    summary: 'Create a facility (admin only).',
    security: bearerSecurity,
    request: { body: jsonBody(createFacilityBodySchema) },
    responses: { 201: ok('Created facility.'), ...pickErrorResponses(401, 403, 409) },
  });

  registry.registerPath({
    method: 'patch',
    path: '/facilities/{id}',
    tags: ['facilities'],
    summary: 'Update a facility (admin only).',
    security: bearerSecurity,
    request: { params: facilityIdParamsSchema, body: jsonBody(updateFacilityBodySchema) },
    responses: { 200: ok('Updated facility.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  registry.registerPath({
    method: 'delete',
    path: '/facilities/{id}',
    tags: ['facilities'],
    summary: 'Delete a facility (admin only).',
    security: bearerSecurity,
    request: { params: facilityIdParamsSchema },
    responses: { 204: noContent('Deleted.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  // ── /locked-rooms ────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/locked-rooms',
    tags: ['locked-rooms'],
    summary: 'List locked-room overrides.',
    security: bearerSecurity,
    request: { query: listLockedRoomsQuerySchema },
    responses: { 200: ok('Paged locked-room list.'), ...pickErrorResponses(401) },
  });

  registry.registerPath({
    method: 'get',
    path: '/locked-rooms/{id}',
    tags: ['locked-rooms'],
    summary: 'Fetch a locked-room override.',
    security: bearerSecurity,
    request: { params: lockedRoomIdParamsSchema },
    responses: { 200: ok('Locked-room payload.'), ...pickErrorResponses(401, 404) },
  });

  registry.registerPath({
    method: 'post',
    path: '/locked-rooms',
    tags: ['locked-rooms'],
    summary: 'Create a locked-room override (admin only).',
    security: bearerSecurity,
    request: { body: jsonBody(createLockedRoomBodySchema) },
    responses: { 201: ok('Created locked-room override.'), ...pickErrorResponses(401, 403, 409) },
  });

  // PATCH `/locked-rooms/{id}` is currently mounted in `routes/locked-rooms.ts`
  // but is not in the api_design backlog snapshot. Document it because the code
  // is the source of truth.
  registry.registerPath({
    method: 'patch',
    path: '/locked-rooms/{id}',
    tags: ['locked-rooms'],
    summary: 'Update a locked-room override (admin only).',
    security: bearerSecurity,
    request: { params: lockedRoomIdParamsSchema, body: jsonBody(updateLockedRoomBodySchema) },
    responses: { 200: ok('Updated locked-room override.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  registry.registerPath({
    method: 'delete',
    path: '/locked-rooms/{id}',
    tags: ['locked-rooms'],
    summary: 'Delete a locked-room override (admin only).',
    security: bearerSecurity,
    request: { params: lockedRoomIdParamsSchema },
    responses: { 204: noContent('Deleted.'), ...pickErrorResponses(401, 403, 404) },
  });

  // ── /lecturers ───────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/lecturers',
    tags: ['lecturers'],
    summary: 'List lecturers.',
    security: bearerSecurity,
    request: { query: listLecturersQuerySchema },
    responses: { 200: ok('Paged lecturer list.'), ...pickErrorResponses(401) },
  });

  registry.registerPath({
    method: 'get',
    path: '/lecturers/{id}',
    tags: ['lecturers'],
    summary: 'Fetch a lecturer.',
    security: bearerSecurity,
    request: { params: lecturerIdParamsSchema },
    responses: { 200: ok('Lecturer payload.'), ...pickErrorResponses(401, 404) },
  });

  registry.registerPath({
    method: 'post',
    path: '/lecturers',
    tags: ['lecturers'],
    summary: 'Create a lecturer.',
    security: bearerSecurity,
    request: { body: jsonBody(createLecturerBodySchema) },
    responses: { 201: ok('Created lecturer.'), ...pickErrorResponses(401, 403, 409) },
  });

  registry.registerPath({
    method: 'patch',
    path: '/lecturers/{id}',
    tags: ['lecturers'],
    summary: 'Update a lecturer.',
    security: bearerSecurity,
    request: { params: lecturerIdParamsSchema, body: jsonBody(updateLecturerBodySchema) },
    responses: { 200: ok('Updated lecturer.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  registry.registerPath({
    method: 'delete',
    path: '/lecturers/{id}',
    tags: ['lecturers'],
    summary: 'Delete a lecturer (admin only).',
    security: bearerSecurity,
    request: { params: lecturerIdParamsSchema },
    responses: { 204: noContent('Deleted.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  // ── /courses ─────────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/courses',
    tags: ['courses'],
    summary: 'List courses.',
    security: bearerSecurity,
    request: { query: listCoursesQuerySchema },
    responses: { 200: ok('Paged course list.'), ...pickErrorResponses(401) },
  });

  registry.registerPath({
    method: 'get',
    path: '/courses/{id}',
    tags: ['courses'],
    summary: 'Fetch a course.',
    security: bearerSecurity,
    request: { params: courseIdParamsSchema },
    responses: { 200: ok('Course payload.'), ...pickErrorResponses(401, 404) },
  });

  registry.registerPath({
    method: 'post',
    path: '/courses',
    tags: ['courses'],
    summary: 'Create a course.',
    security: bearerSecurity,
    request: { body: jsonBody(createCourseBodySchema) },
    responses: { 201: ok('Created course.'), ...pickErrorResponses(401, 403, 409) },
  });

  registry.registerPath({
    method: 'patch',
    path: '/courses/{id}',
    tags: ['courses'],
    summary: 'Update a course.',
    security: bearerSecurity,
    request: { params: courseIdParamsSchema, body: jsonBody(updateCourseBodySchema) },
    responses: { 200: ok('Updated course.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  registry.registerPath({
    method: 'delete',
    path: '/courses/{id}',
    tags: ['courses'],
    summary: 'Delete a course (admin only).',
    security: bearerSecurity,
    request: { params: courseIdParamsSchema },
    responses: { 204: noContent('Deleted.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  // ── /course-offerings ────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/course-offerings',
    tags: ['course-offerings'],
    summary: 'List course offerings.',
    security: bearerSecurity,
    request: { query: listCourseOfferingsQuerySchema },
    responses: { 200: ok('Paged course-offering list.'), ...pickErrorResponses(401) },
  });

  registry.registerPath({
    method: 'get',
    path: '/course-offerings/{id}',
    tags: ['course-offerings'],
    summary: 'Fetch a course offering.',
    security: bearerSecurity,
    request: { params: courseOfferingIdParamsSchema },
    responses: { 200: ok('Offering payload.'), ...pickErrorResponses(401, 404) },
  });

  registry.registerPath({
    method: 'post',
    path: '/course-offerings',
    tags: ['course-offerings'],
    summary: 'Create a course offering. Admin-only fields are filtered for non-admins.',
    security: bearerSecurity,
    request: { body: jsonBody(createCourseOfferingBodySchema) },
    responses: { 201: ok('Created offering.'), ...pickErrorResponses(401, 403, 409) },
  });

  registry.registerPath({
    method: 'patch',
    path: '/course-offerings/{id}',
    tags: ['course-offerings'],
    summary: 'Update a course offering (admin only).',
    security: bearerSecurity,
    request: {
      params: courseOfferingIdParamsSchema,
      body: jsonBody(updateCourseOfferingBodySchema),
    },
    responses: { 200: ok('Updated offering.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  registry.registerPath({
    method: 'patch',
    path: '/course-offerings/{id}/student-count',
    tags: ['course-offerings'],
    summary: 'Update only the effective student count for an offering.',
    security: bearerSecurity,
    request: {
      params: courseOfferingIdParamsSchema,
      body: jsonBody(updateStudentCountBodySchema),
    },
    responses: { 200: ok('Updated student count.'), ...pickErrorResponses(401, 403, 404) },
  });

  registry.registerPath({
    method: 'delete',
    path: '/course-offerings/{id}',
    tags: ['course-offerings'],
    summary: 'Delete a course offering (admin only).',
    security: bearerSecurity,
    request: { params: courseOfferingIdParamsSchema },
    responses: { 204: noContent('Deleted.'), ...pickErrorResponses(401, 403, 404, 409) },
  });

  // ── /schedule-runs ───────────────────────────────────────────────────────
  // NOTE: handlers under `routes/schedule-runs.ts` are still `notImplemented`
  // stubs (Phase 3). The schemas + paths are real — the OpenAPI document is the
  // contract worker implementations will fulfil.
  registry.registerPath({
    method: 'get',
    path: '/schedule-runs',
    tags: ['schedule-runs'],
    summary: 'List GA runs visible to the caller.',
    security: bearerSecurity,
    request: { query: listScheduleRunsQuerySchema },
    responses: {
      200: ok('Paged schedule-run list.'),
      ...pickErrorResponses(401, 403),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/schedule-runs',
    tags: ['schedule-runs'],
    summary: 'Enqueue a new GA run.',
    security: bearerSecurity,
    request: { body: jsonBody(createScheduleRunBodySchema) },
    responses: {
      202: ok('Run accepted and queued.'),
      ...pickErrorResponses(401, 403, 422),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/schedule-runs/{id}',
    tags: ['schedule-runs'],
    summary: 'Fetch a single GA run with status, summary, and assignments.',
    security: bearerSecurity,
    request: { params: scheduleRunIdParamsSchema },
    responses: {
      200: okJson('Run payload.', scheduleRunDetailResponseSchema),
      ...pickErrorResponses(401, 403, 404),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/schedule-runs/{id}/stream',
    tags: ['schedule-runs'],
    summary:
      'Subscribe to live progress events via Server-Sent Events (`text/event-stream`).',
    security: bearerSecurity,
    request: { params: scheduleRunStreamParamsSchema },
    responses: {
      200: {
        description:
          'SSE stream of `progress`, `status`, and `done` events. Each event carries a JSON `data:` payload terminated by a blank line.',
        content: { 'text/event-stream': { schema: z.string() } },
      },
      ...pickErrorResponses(401, 403, 404),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/schedule-runs/{id}/cancel',
    tags: ['schedule-runs'],
    summary: 'Request cancellation of a running GA job.',
    security: bearerSecurity,
    request: {
      params: scheduleRunIdParamsSchema,
      body: jsonBody(emptyBodySchema),
    },
    responses: {
      202: ok('Cancellation requested.'),
      ...pickErrorResponses(401, 403, 404, 409),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/schedule-runs/{id}',
    tags: ['schedule-runs'],
    summary: 'Delete a GA run and its assignments.',
    security: bearerSecurity,
    request: { params: scheduleRunIdParamsSchema },
    responses: {
      204: noContent('Deleted.'),
      ...pickErrorResponses(401, 403, 404, 409),
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/schedule-runs/{id}/assignments/{assignmentId}',
    tags: ['schedule-runs'],
    summary: 'Override a single assignment in a completed run (admin only).',
    security: bearerSecurity,
    request: {
      params: scheduleRunAssignmentParamsSchema,
      body: jsonBody(overrideAssignmentBodySchema),
    },
    responses: {
      200: ok('Override applied.'),
      ...pickErrorResponses(401, 403, 404, 409, 422),
    },
  });
}
