/**
 * `/schedule-runs` routes (api_design §5.3.8, techspec §7.1).
 *
 * Phase 3 Task 5 lands the `POST /` handler with:
 *   - `Idempotency-Key` header — same key + same body returns the original
 *     202; same key + different body → 409 `IDEMPOTENCY_CONFLICT`.
 *   - 5 runs / 5 min per `req.user.id` rate limit (`rateLimitRun`).
 *   - 422 `NO_ACTIVE_SEMESTER` when the target semester has no offerings.
 *   - 503 `QUEUE_UNAVAILABLE` when the BullMQ enqueue throws (Redis down,
 *     queue closed). The row is marked `FAILED` so it isn't orphaned in
 *     `QUEUED`.
 *   - `AuditLog` entry `schedule_run.create` per §8 on successful enqueue.
 *
 */

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import IORedis from "ioredis";

import { validate } from "../middleware/validate";
import { requireAuth } from "../middleware/auth";
import { rateLimitRun } from "../middleware/rateLimit";
import {
  cancelScheduleRunBodySchema,
  createScheduleRunBodySchema,
  listScheduleRunsQuerySchema,
  overrideAssignmentBodySchema,
  scheduleRunAssignmentParamsSchema,
  scheduleRunIdParamsSchema,
  scheduleRunStreamParamsSchema,
  type CreateScheduleRunBody,
  type OverrideAssignmentBody,
} from "../schemas/schedule-runs";
import {
  AuthError,
  ConflictError,
  DomainError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
  type ValidationIssue,
} from "../errors";
import {
  isPrismaForeignKeyError,
  isPrismaNotFound,
  isPrismaUniqueViolation,
} from "../lib/prismaErrors";
import { getCrudRepositories } from "../lib/crudContext";
import { buildListResponse } from "../lib/listResponse";
import { diff, writeAudit } from "../lib/audit";
import { enqueueGaPipelineRun } from "../../queue/ga-pipeline";
import type {
  AssignmentWithRun,
  ScheduleRunAssignmentDetail,
  ScheduleRunDetailRecord,
  ScheduleRunRow,
  ScheduleRunSummaryRecord,
} from "../../repo/scheduleRunRepo";
import {
  gaProgressChannel,
  type ProgressEvent,
  type RunStatus,
} from "../../worker/progressChannel";
import { requestCancellation } from "../../queue/cancellation";

const IDEMPOTENCY_HEADER = "Idempotency-Key";

interface ScheduleRunCreateResponse {
  id: string;
  status: string;
  semesterId: number;
  createdById: number;
  createdAt: string;
}

function toCreateResponse(row: ScheduleRunRow): ScheduleRunCreateResponse {
  return {
    id: row.id,
    status: row.status,
    semesterId: row.semesterId,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Canonical JSON used for idempotency-body comparison. Sorting keys means
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hash identically — clients that
 * regenerate request bodies without preserving key order still match.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

function readIdempotencyKey(req: Request): string | null {
  const raw = req.header(IDEMPOTENCY_HEADER);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function postCreate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new AuthError("UNAUTHORIZED", "Authentication required"));
      return;
    }
    const body = req.body as CreateScheduleRunBody;
    const idempotencyKey = readIdempotencyKey(req);
    const repos = getCrudRepositories();

    const configJson = canonicalJson(body.config);

    // Idempotent replay path. Per api_design §7: same key + same body returns
    // the original 202; same key + different body → 409.
    if (idempotencyKey) {
      const existing =
        await repos.scheduleRuns.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        const sameBody =
          existing.semesterId === body.semesterId &&
          existing.configJson === configJson;
        if (!sameBody) {
          next(
            new ConflictError(
              "IDEMPOTENCY_CONFLICT",
              "Idempotency-Key was reused with a different request body",
            ),
          );
          return;
        }
        res.status(202).json(toCreateResponse(existing));
        return;
      }
    }

    // 422 NO_ACTIVE_SEMESTER — the target semester has no offerings, so the
    // GA has nothing to schedule. The error code follows api_design §5.3.8
    // even though strictly speaking it's "no offerings for this semester".
    const offeringCount = await repos.scheduleRuns.countOfferingsForSemester(
      body.semesterId,
    );
    if (offeringCount === 0) {
      next(
        new DomainError(
          "NO_ACTIVE_SEMESTER",
          `Semester ${body.semesterId} has no offerings to schedule`,
          { semesterId: body.semesterId },
        ),
      );
      return;
    }

    let created: ScheduleRunRow;
    try {
      created = await repos.scheduleRuns.create({
        semesterId: body.semesterId,
        createdById: req.user.id,
        configJson,
        idempotencyKey: idempotencyKey ?? null,
      });
    } catch (err) {
      if (isPrismaUniqueViolation(err) && idempotencyKey) {
        // Race: another request with the same key inserted between our
        // findByIdempotencyKey and create. Fall back to the existing row.
        const existing =
          await repos.scheduleRuns.findByIdempotencyKey(idempotencyKey);
        if (existing) {
          const sameBody =
            existing.semesterId === body.semesterId &&
            existing.configJson === configJson;
          if (!sameBody) {
            next(
              new ConflictError(
                "IDEMPOTENCY_CONFLICT",
                "Idempotency-Key was reused with a different request body",
              ),
            );
            return;
          }
          res.status(202).json(toCreateResponse(existing));
          return;
        }
      }
      throw err;
    }

    // Enqueue. If Redis / BullMQ is down, mark the row FAILED so it isn't
    // orphaned in QUEUED, then surface 503 QUEUE_UNAVAILABLE.
    try {
      const enqueueOpts: { idempotencyKey?: string } = {};
      if (idempotencyKey) enqueueOpts.idempotencyKey = idempotencyKey;
      await enqueueGaPipelineRun(created.id, enqueueOpts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await repos.scheduleRuns
        .markFailed(created.id, "QUEUE_UNAVAILABLE", message)
        .catch(() => {
          // Best-effort cleanup; the original 503 is still the right surface.
        });
      next(
        new ServiceUnavailableError(
          "QUEUE_UNAVAILABLE",
          "Schedule run queue is unavailable",
        ),
      );
      return;
    }

    // §8 audit: `schedule_run.create` carries `{ semesterId, config }`.
    await writeAudit(req, {
      action: "schedule_run.create",
      entityType: "ScheduleRun",
      entityId: created.id,
      metadata: {
        before: null,
        after: {
          id: created.id,
          status: created.status,
          semesterId: created.semesterId,
          config: body.config,
          idempotencyKey: created.idempotencyKey,
        },
      },
    });

    res.status(202).json(toCreateResponse(created));
  } catch (err) {
    next(err);
  }
}

// ─── GET / DELETE handlers (Phase 3 Task 6) ───────────────────────────────

interface ListQuery {
  page: number;
  pageSize: number;
  sort?: string;
  status?:
    | "QUEUED"
    | "RUNNING"
    | "COMPLETED"
    | "STAGNATED"
    | "SSA_INFEASIBLE"
    | "PRE_GA_EMPTY"
    | "CANCELLED"
    | "FAILED";
  semesterId?: number;
}

interface ScheduleRunSummaryWire {
  id: string;
  status: string;
  semesterId: number;
  createdById: number;
  bestFitness: number;
  hardViolations: number;
  softPenalty: number;
  competencyMismatch: number;
  loadPenalty: number;
  capacityShortfallPenalty: number;
  fragmentationPenalty: number;
  generationsRun: number;
  currentGeneration: number;
  stagnatedEarly: boolean;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

function toSummaryWire(r: ScheduleRunSummaryRecord): ScheduleRunSummaryWire {
  return {
    id: r.id,
    status: r.status,
    semesterId: r.semesterId,
    createdById: r.createdById,
    bestFitness: r.bestFitness,
    hardViolations: r.hardViolations,
    softPenalty: r.softPenalty,
    competencyMismatch: r.competencyMismatch,
    loadPenalty: r.loadPenalty,
    capacityShortfallPenalty: r.capacityShortfallPenalty,
    fragmentationPenalty: r.fragmentationPenalty,
    generationsRun: r.generationsRun,
    currentGeneration: r.currentGeneration,
    stagnatedEarly: r.stagnatedEarly,
    durationMs: r.durationMs,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Tolerant JSON parse — the column may already contain `null` (no SSA run yet)
 * or `[]` (no history yet). Anything malformed returns the raw string so the
 * audit trail isn't lost; the frontend can fall back gracefully.
 */
function parseJsonField(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function getList(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new AuthError("UNAUTHORIZED", "Authentication required"));
      return;
    }
    const q = req.query as unknown as ListQuery;
    const repos = getCrudRepositories();

    // Owner-vs-admin filter: `user` callers always see only their own runs.
    // Admin sees everything. The repo just honours `filter.createdById`.
    const filter: {
      status?: ListQuery["status"];
      semesterId?: number;
      createdById?: number;
    } = {};
    if (q.status !== undefined) filter.status = q.status;
    if (q.semesterId !== undefined) filter.semesterId = q.semesterId;
    if (req.user.role === "user") filter.createdById = req.user.id;

    const opts: Parameters<typeof repos.scheduleRuns.list>[0] = {
      filter,
      page: q.page,
      pageSize: q.pageSize,
    };
    if (q.sort !== undefined) opts.sort = q.sort;

    const { rows, total } = await repos.scheduleRuns.list(opts);
    res.status(200).json(
      buildListResponse(rows.map(toSummaryWire), {
        page: q.page,
        pageSize: q.pageSize,
        total,
      }),
    );
  } catch (err) {
    next(err);
  }
}

interface IdParams {
  id: string;
}

interface SessionWire {
  assignmentId: number;
  sessionIndex: number;
  roomId: number;
  isFixedRoom: boolean;
  manualOverride: boolean;
  lecturerIds: number[];
  timeSlots: Array<{
    id: number;
    day: string;
    startTime: string;
    endTime: string;
  }>;
}

interface GroupedAssignmentWire {
  offeringId: number;
  offering: {
    id: number;
    courseCode: string;
    courseName: string;
    lecturers: Array<{ id: number; name: string }>;
  };
  sessions: SessionWire[];
}

function groupAssignmentsByOffering(
  flat: ScheduleRunAssignmentDetail[],
): GroupedAssignmentWire[] {
  const grouped = new Map<number, GroupedAssignmentWire>();
  for (const a of flat) {
    let entry = grouped.get(a.offeringId);
    if (!entry) {
      entry = {
        offeringId: a.offeringId,
        offering: a.offering,
        sessions: [],
      };
      grouped.set(a.offeringId, entry);
    }
    entry.sessions.push({
      assignmentId: a.id,
      sessionIndex: a.sessionIndex,
      roomId: a.roomId,
      isFixedRoom: a.isFixedRoom,
      manualOverride: a.manualOverride,
      lecturerIds: a.lecturerIds,
      timeSlots: a.slots,
    });
  }
  return Array.from(grouped.values());
}

interface ScheduleRunDetailWire extends ScheduleRunSummaryWire {
  config: unknown;
  preGASummary: unknown;
  ssaResult: unknown;
  /**
   * Phase 16 #13 — offerings whose SSA bipartite adjacency degraded to the
   * per-slot fallback (sourced from `SSAResult.degradedOfferings`). Empty on
   * legacy rows persisted before Phase 16 #9 wired the SSA field. Frontend
   * Fragmented Sessions panel (#15) renders this alongside
   * `fragmentationRequired`; the two lists may overlap.
   */
  degradedOfferings: number[];
  /**
   * Phase 16 #13 — offerings whose Pre-GA `longestContiguousRun < sessionDuration`
   * (derived from `preGASummary.warnings[]` filtered to FRAGMENTATION_REQUIRED).
   * Empty on legacy rows persisted before Phase 16 #1/#2.
   */
  fragmentationRequired: number[];
  history: unknown;
  avgHistory: unknown;
  idempotencyKey: string | null;
  assignments: GroupedAssignmentWire[];
}

/**
 * Phase 16 #13 — defensive extractor for `SSAResult.degradedOfferings`.
 * Returns `[]` for legacy rows whose `ssaResultJson` predates the field, or
 * malformed payloads (the audit-tolerant `parseJsonField` may have already
 * returned the raw string). Filters to numeric entries to guard against an
 * upstream wire-shape drift.
 */
function extractDegradedOfferings(parsedSsa: unknown): number[] {
  if (
    typeof parsedSsa === 'object' &&
    parsedSsa !== null &&
    'degradedOfferings' in parsedSsa
  ) {
    const value = (parsedSsa as { degradedOfferings: unknown }).degradedOfferings;
    if (Array.isArray(value)) {
      return value.filter((x): x is number => typeof x === 'number');
    }
  }
  return [];
}

/**
 * Phase 16 #13 — defensive extractor for `preGASummary.warnings[]` filtered to
 * `FRAGMENTATION_REQUIRED` entries. Returns the offering ids in source order.
 * `[]` for legacy rows whose `preGASummaryJson` predates Phase 16 #2 (no
 * `warnings[]` channel) or for rows where no candidate was fragmentation-flagged.
 */
function extractFragmentationRequired(parsedSummary: unknown): number[] {
  if (
    typeof parsedSummary === 'object' &&
    parsedSummary !== null &&
    'warnings' in parsedSummary
  ) {
    const warnings = (parsedSummary as { warnings: unknown }).warnings;
    if (Array.isArray(warnings)) {
      const ids: number[] = [];
      for (const w of warnings) {
        if (
          typeof w === 'object' &&
          w !== null &&
          (w as { code?: unknown }).code === 'FRAGMENTATION_REQUIRED' &&
          typeof (w as { offeringId?: unknown }).offeringId === 'number'
        ) {
          ids.push((w as { offeringId: number }).offeringId);
        }
      }
      return ids;
    }
  }
  return [];
}

function toDetailWire(
  r: ScheduleRunDetailRecord,
  assignments: ScheduleRunAssignmentDetail[],
): ScheduleRunDetailWire {
  const parsedSsa = parseJsonField(r.ssaResultJson);
  const parsedSummary = parseJsonField(r.preGASummaryJson);
  return {
    ...toSummaryWire(r),
    config: parseJsonField(r.configJson),
    preGASummary: parsedSummary,
    ssaResult: parsedSsa,
    degradedOfferings: extractDegradedOfferings(parsedSsa),
    fragmentationRequired: extractFragmentationRequired(parsedSummary),
    history: parseJsonField(r.historyJson),
    avgHistory: parseJsonField(r.avgHistoryJson),
    idempotencyKey: r.idempotencyKey,
    assignments: groupAssignmentsByOffering(assignments),
  };
}

async function getOne(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new AuthError("UNAUTHORIZED", "Authentication required"));
      return;
    }
    const { id } = req.params as unknown as IdParams;
    const repos = getCrudRepositories();
    const row = await repos.scheduleRuns.findDetailById(id);

    // Owner-vs-admin: a non-owner `user` gets 404 (api_design §5.2 — never
    // leak existence). Admin always sees the row.
    if (!row || (req.user.role === "user" && row.createdById !== req.user.id)) {
      next(new NotFoundError("Schedule run not found"));
      return;
    }

    const assignments = await repos.scheduleRuns.findAssignments(id);
    res.status(200).json(toDetailWire(row, assignments));
  } catch (err) {
    next(err);
  }
}

async function deleteOne(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new AuthError("UNAUTHORIZED", "Authentication required"));
      return;
    }
    const { id } = req.params as unknown as IdParams;
    const repos = getCrudRepositories();

    const existing = await repos.scheduleRuns.findDetailById(id);
    if (
      !existing ||
      (req.user.role === "user" && existing.createdById !== req.user.id)
    ) {
      next(new NotFoundError("Schedule run not found"));
      return;
    }

    // 409 if RUNNING — must cancel first (api_design §5.3.8).
    if (existing.status === "RUNNING") {
      next(
        new ConflictError(
          "ILLEGAL_STATE_TRANSITION",
          "Cannot delete a RUNNING schedule run; cancel it first",
        ),
      );
      return;
    }

    try {
      await repos.scheduleRuns.delete(id);
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError("Schedule run not found"));
        return;
      }
      throw err;
    }

    // §8 audit: `schedule_run.delete` carries `{ status }` (the prior status).
    await writeAudit(req, {
      action: "schedule_run.delete",
      entityType: "ScheduleRun",
      entityId: id,
      metadata: { status: existing.status },
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// ─── SSE handler (Phase 3 Task 7) ────────────────────────────────────────

const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "SSA_INFEASIBLE",
  "PRE_GA_EMPTY",
  "STAGNATED",
]);

const HEARTBEAT_INTERVAL_MS = 15_000;

function sendSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function getStream(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new AuthError("UNAUTHORIZED", "Authentication required"));
      return;
    }
    const { id: runId } = req.params as unknown as IdParams;
    const repos = getCrudRepositories();

    const run = await repos.scheduleRuns.findDetailById(runId);
    if (!run || (req.user.role === "user" && run.createdById !== req.user.id)) {
      next(new NotFoundError("Schedule run not found"));
      return;
    }

    // If already terminal, send final state and close immediately.
    if (TERMINAL_STATUSES.has(run.status as RunStatus)) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.status(200);
      res.flushHeaders();
      sendSseEvent(res, "state", { runId, status: run.status });
      res.end();
      return;
    }

    // Set up SSE headers.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.status(200);
    res.flushHeaders();

    // Dedicated subscriber connection — Redis pub/sub requires a connection
    // that does nothing else once SUBSCRIBE is issued.
    const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
    const subscriber = new IORedis(redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    });

    const channel = gaProgressChannel(runId);
    let closed = false;

    function cleanup(): void {
      if (closed) return;
      closed = true;
      clearInterval(heartbeatTimer);
      subscriber.unsubscribe(channel).catch(() => {});
      subscriber.disconnect();
    }

    const heartbeatTimer = setInterval(() => {
      if (closed) return;
      res.write(": heartbeat\n\n");
    }, HEARTBEAT_INTERVAL_MS);

    subscriber.on("message", (_ch: string, raw: string) => {
      if (closed) return;
      let event: ProgressEvent;
      try {
        event = JSON.parse(raw) as ProgressEvent;
      } catch {
        return;
      }

      switch (event.type) {
        case "progress":
          sendSseEvent(res, "progress", {
            runId,
            status: "RUNNING",
            currentGeneration: event.snapshot.generation,
            bestFitness: event.snapshot.bestFitness,
            avgFitness: event.snapshot.avgFitness,
            hardViolations: event.snapshot.hardViolations,
            softPenalty: event.snapshot.softPenalty,
            competencyMismatch: event.snapshot.competencyMismatch,
            structuralPenalty: event.snapshot.structuralPenalty,
            preferencePenalty: event.snapshot.preferencePenalty,
            loadPenalty: event.snapshot.loadPenalty,
            capacityShortfallPenalty: event.snapshot.capacityShortfallPenalty,
            fragmentationPenalty: event.snapshot.fragmentationPenalty,
            lecturerDistributionEntropy: event.snapshot.lecturerDistributionEntropy,
          });
          break;
        case "state":
          sendSseEvent(res, "state", { runId, status: event.status });
          if (TERMINAL_STATUSES.has(event.status)) {
            cleanup();
            res.end();
          }
          break;
        case "error":
          sendSseEvent(res, "error", {
            code: "RUN_ERROR",
            message: event.message,
          });
          break;
      }
    });

    subscriber.on("error", () => {
      if (closed) return;
      sendSseEvent(res, "error", {
        code: "STREAM_ERROR",
        message: "Redis subscriber connection lost",
      });
      cleanup();
      res.end();
    });

    req.on("close", cleanup);

    await subscriber.subscribe(channel);

    // Emit the current state so late-joining clients don't miss a transition
    // that happened between their DB lookup and the subscribe call.
    const freshRun = await repos.scheduleRuns.findDetailById(runId);
    if (freshRun && TERMINAL_STATUSES.has(freshRun.status as RunStatus)) {
      sendSseEvent(res, "state", { runId, status: freshRun.status });
      cleanup();
      res.end();
    }
  } catch (err) {
    next(err);
  }
}

// ─── Cancel handler (Phase 3 Task 8) ────────────────────────────────────

const CANCELLABLE_STATUSES: ReadonlySet<string> = new Set([
  "QUEUED",
  "RUNNING",
]);

async function postCancel(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new AuthError("UNAUTHORIZED", "Authentication required"));
      return;
    }
    const { id: runId } = req.params as unknown as IdParams;
    const repos = getCrudRepositories();

    const run = await repos.scheduleRuns.findDetailById(runId);
    if (!run || (req.user.role === "user" && run.createdById !== req.user.id)) {
      next(new NotFoundError("Schedule run not found"));
      return;
    }

    if (!CANCELLABLE_STATUSES.has(run.status)) {
      next(
        new ConflictError(
          "ILLEGAL_STATE_TRANSITION",
          `Cannot cancel a run with status ${run.status}`,
        ),
      );
      return;
    }

    await requestCancellation(runId);
    await repos.scheduleRuns.cancel(runId);

    await writeAudit(req, {
      action: "schedule_run.cancel",
      entityType: "ScheduleRun",
      entityId: runId,
      metadata: { status: run.status },
    });

    res.status(200).json({ id: runId, status: "CANCELLED" });
  } catch (err) {
    next(err);
  }
}

// ─── Manual override handler (Phase 3 Task 9) ──────────────────────────

const OVERRIDABLE_STATUSES: ReadonlySet<string> = new Set([
  "COMPLETED",
  "STAGNATED",
]);

interface AssignmentParams {
  id: string;
  assignmentId: number;
}

function toAssignmentWire(a: AssignmentWithRun) {
  return {
    id: a.id,
    runId: a.runId,
    offeringId: a.offeringId,
    sessionIndex: a.sessionIndex,
    roomId: a.roomId,
    isFixedRoom: a.isFixedRoom,
    manualOverride: a.manualOverride,
    overriddenById: a.overriddenById,
    overriddenAt: a.overriddenAt ? a.overriddenAt.toISOString() : null,
    notes: a.notes,
    timeSlotIds: a.timeSlotIds,
    lecturerIds: a.lecturerIds,
  };
}

function hasCompetencyOverlap(
  lecturer: { competencies: string[] },
  course: { requiredCompetencies: string[] },
): boolean {
  if (course.requiredCompetencies.length === 0) return true;
  const owned = new Set(lecturer.competencies);
  return course.requiredCompetencies.some((tag) => owned.has(tag));
}

async function assertOverrideLecturersValid(
  lecturerIds: number[] | undefined,
  existing: AssignmentWithRun,
): Promise<void> {
  if (lecturerIds === undefined) return;

  const repos = getCrudRepositories();
  const offering = await repos.courseOfferings.findById(existing.offeringId);
  if (!offering) {
    throw new DomainError(
      "INVALID_REFERENCE",
      `Course offering ${existing.offeringId} does not exist`,
      { field: "offeringId", id: existing.offeringId },
    );
  }
  const course = await repos.courses.findById(offering.courseId);
  if (!course) {
    throw new DomainError(
      "INVALID_REFERENCE",
      `Course ${offering.courseId} does not exist`,
      { field: "courseId", id: offering.courseId },
    );
  }

  const lecturers = await Promise.all(
    lecturerIds.map((lecturerId) => repos.lecturers.findById(lecturerId)),
  );
  const missing = lecturerIds.filter((_, idx) => lecturers[idx] === null);
  if (missing.length > 0) {
    throw new DomainError(
      "INVALID_REFERENCE",
      "Referenced lecturer does not exist",
      { field: "lecturerIds", ids: missing },
    );
  }

  const semesterMismatches = lecturers
    .map((lecturer, idx) => ({ lecturer: lecturer!, id: lecturerIds[idx]! }))
    .filter(({ lecturer }) => lecturer.semesterId !== offering.semesterId)
    .map(({ lecturer, id }) => ({ id, actualSemesterId: lecturer.semesterId }));
  if (semesterMismatches.length > 0) {
    const issues: ValidationIssue[] = [{
      path: ["lecturerIds"],
      message:
        `lecturerIds reference ${semesterMismatches[0]!.id} belongs to semester ` +
        `${semesterMismatches[0]!.actualSemesterId} but offering is in semester ${offering.semesterId}.`,
      code: "CROSS_SEMESTER_REFERENCE",
    }];
    throw new ValidationError(
      issues[0]!.message,
      issues,
      "CROSS_SEMESTER_REFERENCE",
      {
        field: "lecturerIds",
        expectedSemesterId: offering.semesterId,
        mismatches: semesterMismatches,
      },
    );
  }

  const competencyMismatches = lecturers
    .map((lecturer, idx) => ({ lecturer: lecturer!, id: lecturerIds[idx]! }))
    .filter(({ lecturer }) => !hasCompetencyOverlap(lecturer, course))
    .map(({ id }) => ({ id }));
  if (competencyMismatches.length > 0) {
    throw new DomainError(
      "COMPETENCY_MISMATCH",
      "One or more lecturers do not satisfy the course required competencies",
      {
        field: "lecturerIds",
        courseId: course.id,
        requiredCompetencies: course.requiredCompetencies,
        mismatches: competencyMismatches,
      },
    );
  }
}

async function putOverrideAssignment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new AuthError("UNAUTHORIZED", "Authentication required"));
      return;
    }
    const { id: runId, assignmentId } =
      req.params as unknown as AssignmentParams;
    const body = req.body as OverrideAssignmentBody;
    const repos = getCrudRepositories();

    const existing = await repos.scheduleRuns.findAssignmentById(assignmentId);

    if (!existing || existing.runId !== runId) {
      next(new NotFoundError("Assignment not found"));
      return;
    }

    // Owner-vs-admin gate: admin always allowed; user only when they own the run.
    if (req.user.role === "user" && existing.run.createdById !== req.user.id) {
      next(new NotFoundError("Assignment not found"));
      return;
    }

    // Status gate: admin can override any terminal run; user only COMPLETED.
    if (req.user.role === "admin") {
      if (!OVERRIDABLE_STATUSES.has(existing.run.status)) {
        next(
          new ConflictError(
            "ILLEGAL_STATE_TRANSITION",
            `Cannot override assignments on a run with status ${existing.run.status}`,
          ),
        );
        return;
      }
    } else {
      if (existing.run.status !== "COMPLETED") {
        next(
          new ConflictError(
            "ILLEGAL_STATE_TRANSITION",
            `Cannot override assignments on a run with status ${existing.run.status}`,
          ),
        );
        return;
      }
    }

    try {
      await assertOverrideLecturersValid(body.lecturerIds, existing);
      const updated = await repos.scheduleRuns.overrideAssignment(
        assignmentId,
        {
          roomId: body.roomId,
          timeSlotIds: body.timeSlotIds,
          lecturerIds: body.lecturerIds,
          notes: body.notes,
          overriddenById: req.user.id,
        },
      );

      const beforeSnap: Record<string, unknown> = {
        roomId: existing.roomId,
        timeSlotIds: existing.timeSlotIds,
        lecturerIds: existing.lecturerIds,
        notes: existing.notes,
        manualOverride: existing.manualOverride,
      };
      const afterSnap: Record<string, unknown> = {
        roomId: updated.roomId,
        timeSlotIds: updated.timeSlotIds,
        lecturerIds: updated.lecturerIds,
        notes: updated.notes,
        manualOverride: updated.manualOverride,
      };

      await writeAudit(req, {
        action: "schedule_run.assignment_override",
        entityType: "ScheduleAssignment",
        entityId: String(assignmentId),
        metadata: {
          runId,
          offeringId: existing.offeringId,
          sessionIndex: existing.sessionIndex,
          ...diff(beforeSnap, afterSnap),
          role: req.user.role,
        },
      });

      res.status(200).json(toAssignmentWire(updated));
    } catch (err) {
      if (isPrismaNotFound(err)) {
        next(new NotFoundError("Assignment not found"));
        return;
      }
      if (isPrismaForeignKeyError(err)) {
        next(
          new DomainError(
            "INVALID_REFERENCE",
            "Referenced room, time slot, or lecturer does not exist",
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

export function createScheduleRunsRouter(): Router {
  const router = Router();

  router.get(
    "/",
    requireAuth(),
    validate({ query: listScheduleRunsQuerySchema }),
    getList,
  );

  router.post(
    "/",
    requireAuth(),
    rateLimitRun(),
    validate({ body: createScheduleRunBodySchema }),
    postCreate,
  );

  router.get(
    "/:id",
    requireAuth(),
    validate({ params: scheduleRunIdParamsSchema }),
    getOne,
  );

  router.get(
    "/:id/stream",
    requireAuth(),
    validate({ params: scheduleRunStreamParamsSchema }),
    getStream,
  );

  router.post(
    "/:id/cancel",
    requireAuth(),
    validate({
      params: scheduleRunIdParamsSchema,
      body: cancelScheduleRunBodySchema,
    }),
    postCancel,
  );

  router.delete(
    "/:id",
    requireAuth(),
    validate({ params: scheduleRunIdParamsSchema }),
    deleteOne,
  );

  router.put(
    "/:id/assignments/:assignmentId",
    requireAuth(),
    validate({
      params: scheduleRunAssignmentParamsSchema,
      body: overrideAssignmentBodySchema,
    }),
    putOverrideAssignment,
  );

  return router;
}
