/**
 * Shared in-memory fakes + helpers for the Phase 2 Task 5 CRUD route tests.
 *
 * Strategy mirrors `tests/api/routes/auth.test.ts`: install in-memory repository
 * fakes via `setCrudRepositoriesForTests()` so the real route handlers + the
 * real auth middleware run end-to-end without Prisma. A future integration
 * suite (backlog Phase 5 §1) will re-run the same flows against a sandbox
 * Postgres.
 */

process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

import type { Role, Weekday } from '@prisma/client';

import type {
  UserRecord,
  UserRepository,
  CreateUserInput,
} from '../../../src/repo/userRepo';
import type {
  SemesterRecord,
  SemesterRepository,
} from '../../../src/repo/semesterRepo';
import type { RoomRecord, RoomRepository } from '../../../src/repo/roomRepo';
import { UnknownFacilityCodeError } from '../../../src/repo/roomRepo';
import type {
  TimeSlotRecord,
  TimeSlotRepository,
} from '../../../src/repo/timeslotRepo';
import type {
  FacilityRecord,
  FacilityRepository,
} from '../../../src/repo/facilityRepo';
import type {
  LockedRoomRecord,
  LockedRoomRepository,
} from '../../../src/repo/lockedRoomRepo';
import type {
  LecturerRecord,
  LecturerRepository,
} from '../../../src/repo/lecturerCrudRepo';
import type {
  CourseRecord,
  CourseRepository,
} from '../../../src/repo/courseCrudRepo';
import type {
  CourseOfferingRecord,
  CourseOfferingRepository,
} from '../../../src/repo/courseOfferingRepo';
import type {
  AuditLogRecord,
  AuditLogRepository,
  CreateAuditLogInput,
} from '../../../src/repo/auditLogRepo';
import type {
  CreateScheduleRunInput,
  ScheduleRunAssignmentDetail,
  ScheduleRunDetailRecord,
  ScheduleRunRepository,
  ScheduleRunRow,
  ScheduleRunSummaryRecord,
} from '../../../src/repo/scheduleRunRepo';
import type { CrudRepositories } from '../../../src/api/lib/crudContext';

/**
 * Full ScheduleRun record stored in the fixture map. The repo's slim/summary/
 * detail projections are derived from this one record so seeders can stuff
 * everything in once. Includes a couple of fields the repo may add over time.
 */
interface FullScheduleRunRow extends ScheduleRunDetailRecord {}

// ─── Generic helpers ──────────────────────────────────────────────────────

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, x) => (x instanceof Date ? x.toISOString() : x)),
    (_, x) => {
      if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x)) {
        const d = new Date(x);
        return Number.isNaN(d.getTime()) ? x : d;
      }
      return x;
    },
  ) as T;
}

function prismaUnique(message = 'Unique constraint failed'): Error {
  const err = new Error(message) as Error & { code?: string };
  err.code = 'P2002';
  return err;
}

function prismaNotFound(message = 'Record not found'): Error {
  const err = new Error(message) as Error & { code?: string };
  err.code = 'P2025';
  return err;
}

function prismaForeignKey(message = 'Foreign key constraint failed'): Error {
  const err = new Error(message) as Error & { code?: string };
  err.code = 'P2003';
  return err;
}

// ─── Fixture ──────────────────────────────────────────────────────────────

export interface CrudFixture {
  repos: CrudRepositories;
  // Direct access to the underlying maps for assertions / seeding.
  userStore: Map<number, UserRecord>;
  semesterStore: Map<number, SemesterRecord>;
  roomStore: Map<number, RoomRecord>;
  timeSlotStore: Map<number, TimeSlotRecord>;
  facilityStore: Map<number, FacilityRecord>;
  lockedRoomStore: Map<number, LockedRoomRecord>;
  lecturerStore: Map<number, LecturerRecord>;
  courseStore: Map<number, CourseRecord>;
  courseOfferingStore: Map<number, CourseOfferingRecord>;
  // Schedule runs created via the repo facade — used by Phase 3 tasks 5 / 6.
  scheduleRunStore: Map<string, FullScheduleRunRow>;
  // Per-run assignment rows pre-shaped for the GET /schedule-runs/:id repo
  // method (`findAssignments`). Tests seed this directly; production hydrates
  // from joined Prisma queries.
  scheduleAssignmentStore: Map<
    number,
    ScheduleRunAssignmentDetail & { runId: string }
  >;
  // Audit log captures every state-changing request. Tests assert against
  // this array rather than peeking at the repo internals.
  auditLogStore: AuditLogRecord[];
  // Toggle that makes the audit-repo `create()` throw so we can assert that
  // a failing audit write does NOT break the user-facing request.
  auditLogFail: { active: boolean };
  // Out-of-band toggle so a test can simulate an active RUNNING run for a
  // given semesterId without needing the full ScheduleRun model.
  runningScheduleRunSemesters: Set<number>;
  // Seeders.
  insertUser(u: Partial<UserRecord> & {
    email: string;
    passwordHash?: string;
    fullName: string;
    role?: Role;
  }): UserRecord;
  insertSemester(s: Partial<SemesterRecord> & { code: string; label: string }): SemesterRecord;
  insertRoom(r: Partial<RoomRecord> & { semesterId: number; name: string; capacity: number }): RoomRecord;
  insertTimeSlot(t: Partial<TimeSlotRecord> & {
    semesterId: number;
    day: Weekday;
    startTime: string;
    endTime: string;
  }): TimeSlotRecord;
  insertFacility(f: Partial<FacilityRecord> & { code: string; label: string }): FacilityRecord;
  insertLockedRoom(l: Partial<LockedRoomRecord> & {
    semesterId: number;
    offeringId: number;
    roomId: number;
    lockedById: number;
  }): LockedRoomRecord;
  insertLecturer(l: Partial<LecturerRecord> & {
    semesterId: number;
    name: string;
  }): LecturerRecord;
  insertCourse(c: Partial<CourseRecord> & {
    semesterId: number;
    code: string;
    name: string;
    sks: number;
  }): CourseRecord;
  insertCourseOffering(o: Partial<CourseOfferingRecord> & {
    semesterId: number;
    courseId: number;
    roomId: number;
    effectiveStudentCount: number;
  }): CourseOfferingRecord;
  insertScheduleRun(r: Partial<FullScheduleRunRow> & {
    id: string;
    semesterId: number;
    createdById: number;
  }): FullScheduleRunRow;
  insertScheduleAssignment(
    a: Partial<ScheduleRunAssignmentDetail> & {
      id: number;
      runId: string;
      offeringId: number;
      roomId: number;
    },
  ): ScheduleRunAssignmentDetail & { runId: string };
}

export function buildCrudFixture(): CrudFixture {
  let nextUserId = 1;
  let nextSemesterId = 1;
  let nextRoomId = 1;
  let nextTimeSlotId = 1;
  let nextFacilityId = 1;
  let nextLockedRoomId = 1;
  let nextLecturerId = 1;
  let nextCourseId = 1;
  let nextCourseOfferingId = 1;
  let nextAuditLogId = 1;

  const userStore = new Map<number, UserRecord>();
  const semesterStore = new Map<number, SemesterRecord>();
  const roomStore = new Map<number, RoomRecord>();
  const timeSlotStore = new Map<number, TimeSlotRecord>();
  const facilityStore = new Map<number, FacilityRecord>();
  const lockedRoomStore = new Map<number, LockedRoomRecord>();
  const lecturerStore = new Map<number, LecturerRecord>();
  const courseStore = new Map<number, CourseRecord>();
  const courseOfferingStore = new Map<number, CourseOfferingRecord>();
  const scheduleRunStore = new Map<string, FullScheduleRunRow>();
  const scheduleAssignmentStore = new Map<
    number,
    ScheduleRunAssignmentDetail & { runId: string }
  >();
  let nextScheduleRunSeq = 1;
  const auditLogStore: AuditLogRecord[] = [];
  const auditLogFail = { active: false };
  const runningScheduleRunSemesters = new Set<number>();

  // ── Users ───────────────────────────────────────────────────────────────
  const users: UserRepository = {
    async findUserByEmail(email) {
      for (const u of userStore.values()) if (u.email === email) return clone(u);
      return null;
    },
    async findUserById(id) {
      const u = userStore.get(id);
      return u ? clone(u) : null;
    },
    async createUser(input: CreateUserInput) {
      for (const u of userStore.values()) if (u.email === input.email) throw prismaUnique();
      const now = new Date();
      const id = nextUserId++;
      const row: UserRecord = {
        id,
        email: input.email,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        role: input.role,
        isActive: true,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      };
      userStore.set(id, row);
      return clone(row);
    },
    async updateLastLogin(id, when) {
      const u = userStore.get(id);
      if (u) {
        u.lastLoginAt = when;
        u.updatedAt = new Date();
      }
    },
    async setActive(id, isActive) {
      const u = userStore.get(id);
      if (!u) throw prismaNotFound();
      u.isActive = isActive;
      u.updatedAt = new Date();
      return clone(u);
    },
    async listUsers({ filter, page, pageSize }) {
      let rows = Array.from(userStore.values());
      if (filter?.role !== undefined) rows = rows.filter((r) => r.role === filter.role);
      if (filter?.isActive !== undefined) rows = rows.filter((r) => r.isActive === filter.isActive);
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const total = rows.length;
      const sliced = rows.slice((page - 1) * pageSize, page * pageSize);
      return { rows: sliced.map(clone), total };
    },
    async updateUser(id, patch) {
      const u = userStore.get(id);
      if (!u) throw prismaNotFound();
      if (patch.role !== undefined) u.role = patch.role;
      if (patch.fullName !== undefined) u.fullName = patch.fullName;
      if (patch.isActive !== undefined) u.isActive = patch.isActive;
      u.updatedAt = new Date();
      return clone(u);
    },
  };

  // ── Semesters ───────────────────────────────────────────────────────────
  const semesters: SemesterRepository = {
    async list({ filter, page, pageSize }) {
      let rows = Array.from(semesterStore.values());
      if (filter?.isActive !== undefined) rows = rows.filter((r) => r.isActive === filter.isActive);
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const total = rows.length;
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize).map(clone), total };
    },
    async findById(id) {
      const r = semesterStore.get(id);
      return r ? clone(r) : null;
    },
    async create(input) {
      for (const r of semesterStore.values()) if (r.code === input.code) throw prismaUnique();
      const now = new Date();
      const id = nextSemesterId++;
      const row: SemesterRecord = {
        id,
        code: input.code,
        label: input.label,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        isActive: false,
        createdAt: now,
        updatedAt: now,
      };
      semesterStore.set(id, row);
      return clone(row);
    },
    async update(id, patch) {
      const r = semesterStore.get(id);
      if (!r) throw prismaNotFound();
      if (patch.label !== undefined) r.label = patch.label;
      if (patch.startsOn !== undefined) r.startsOn = patch.startsOn;
      if (patch.endsOn !== undefined) r.endsOn = patch.endsOn;
      r.updatedAt = new Date();
      return clone(r);
    },
    async activate(id) {
      const target = semesterStore.get(id);
      if (!target) throw prismaNotFound();
      for (const r of semesterStore.values()) {
        if (r.id !== id && r.isActive) {
          r.isActive = false;
          r.updatedAt = new Date();
        }
      }
      target.isActive = true;
      target.updatedAt = new Date();
      return clone(target);
    },
    async delete(id) {
      if (!semesterStore.has(id)) throw prismaNotFound();
      semesterStore.delete(id);
    },
    async hasRelatedRows(id) {
      for (const r of roomStore.values()) if (r.semesterId === id) return true;
      for (const t of timeSlotStore.values()) if (t.semesterId === id) return true;
      for (const lr of lockedRoomStore.values()) if (lr.semesterId === id) return true;
      return false;
    },
  };

  // ── Rooms ───────────────────────────────────────────────────────────────
  function resolveFacilityCodes(codes: string[]): void {
    const known = new Set(Array.from(facilityStore.values()).map((f) => f.code));
    const missing = codes.filter((c) => !known.has(c));
    if (missing.length > 0) throw new UnknownFacilityCodeError(missing);
  }
  const rooms: RoomRepository = {
    async list({ filter, page, pageSize }) {
      let rows = Array.from(roomStore.values());
      if (filter?.semesterId !== undefined) rows = rows.filter((r) => r.semesterId === filter.semesterId);
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const total = rows.length;
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize).map(clone), total };
    },
    async findById(id) {
      const r = roomStore.get(id);
      return r ? clone(r) : null;
    },
    async create(input) {
      resolveFacilityCodes(input.facilities);
      // Schema unique on (semesterId, name).
      for (const r of roomStore.values()) {
        if (r.semesterId === input.semesterId && r.name === input.name) throw prismaUnique();
      }
      if (!semesterStore.has(input.semesterId)) throw prismaForeignKey();
      const now = new Date();
      const id = nextRoomId++;
      const row: RoomRecord = {
        id,
        semesterId: input.semesterId,
        name: input.name,
        capacity: input.capacity,
        facilities: [...input.facilities],
        createdAt: now,
        updatedAt: now,
      };
      roomStore.set(id, row);
      return clone(row);
    },
    async update(id, patch) {
      const r = roomStore.get(id);
      if (!r) throw prismaNotFound();
      if (patch.facilities !== undefined) {
        resolveFacilityCodes(patch.facilities);
        r.facilities = [...patch.facilities];
      }
      if (patch.name !== undefined) {
        for (const other of roomStore.values()) {
          if (other.id !== id && other.semesterId === r.semesterId && other.name === patch.name) {
            throw prismaUnique();
          }
        }
        r.name = patch.name;
      }
      if (patch.capacity !== undefined) r.capacity = patch.capacity;
      r.updatedAt = new Date();
      return clone(r);
    },
    async delete(id) {
      if (!roomStore.has(id)) throw prismaNotFound();
      roomStore.delete(id);
    },
  };

  // ── TimeSlots ───────────────────────────────────────────────────────────
  const timeSlots: TimeSlotRepository = {
    async list({ filter, page, pageSize }) {
      let rows = Array.from(timeSlotStore.values());
      if (filter?.semesterId !== undefined) rows = rows.filter((r) => r.semesterId === filter.semesterId);
      if (filter?.day !== undefined) rows = rows.filter((r) => r.day === filter.day);
      rows.sort((a, b) => (a.day === b.day ? a.startTime.localeCompare(b.startTime) : a.day.localeCompare(b.day)));
      const total = rows.length;
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize).map(clone), total };
    },
    async findById(id) {
      const r = timeSlotStore.get(id);
      return r ? clone(r) : null;
    },
    async create(input) {
      for (const r of timeSlotStore.values()) {
        if (
          r.semesterId === input.semesterId &&
          r.day === input.day &&
          r.startTime === input.startTime &&
          r.endTime === input.endTime
        ) {
          throw prismaUnique();
        }
      }
      if (!semesterStore.has(input.semesterId)) throw prismaForeignKey();
      const id = nextTimeSlotId++;
      const row: TimeSlotRecord = {
        id,
        semesterId: input.semesterId,
        day: input.day,
        startTime: input.startTime,
        endTime: input.endTime,
      };
      timeSlotStore.set(id, row);
      return clone(row);
    },
    async update(id, patch) {
      const r = timeSlotStore.get(id);
      if (!r) throw prismaNotFound();
      if (patch.day !== undefined) r.day = patch.day;
      if (patch.startTime !== undefined) r.startTime = patch.startTime;
      if (patch.endTime !== undefined) r.endTime = patch.endTime;
      return clone(r);
    },
    async delete(id) {
      if (!timeSlotStore.has(id)) throw prismaNotFound();
      timeSlotStore.delete(id);
    },
  };

  // ── Facilities ──────────────────────────────────────────────────────────
  const facilities: FacilityRepository = {
    async list({ page, pageSize }) {
      const rows = Array.from(facilityStore.values()).sort((a, b) => a.code.localeCompare(b.code));
      const total = rows.length;
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize).map(clone), total };
    },
    async findById(id) {
      const r = facilityStore.get(id);
      return r ? clone(r) : null;
    },
    async create(input) {
      for (const r of facilityStore.values()) if (r.code === input.code) throw prismaUnique();
      const id = nextFacilityId++;
      const row: FacilityRecord = { id, code: input.code, label: input.label };
      facilityStore.set(id, row);
      return clone(row);
    },
    async update(id, patch) {
      const r = facilityStore.get(id);
      if (!r) throw prismaNotFound();
      if (patch.code !== undefined) {
        for (const other of facilityStore.values()) {
          if (other.id !== id && other.code === patch.code) throw prismaUnique();
        }
        r.code = patch.code;
      }
      if (patch.label !== undefined) r.label = patch.label;
      return clone(r);
    },
    async delete(id) {
      if (!facilityStore.has(id)) throw prismaNotFound();
      // Mirror onDelete: Restrict — referenced by any room → throw P2003.
      for (const room of roomStore.values()) {
        const facCode = facilityStore.get(id)?.code;
        if (facCode && room.facilities.includes(facCode)) throw prismaForeignKey();
      }
      facilityStore.delete(id);
    },
  };

  // ── LockedRooms ─────────────────────────────────────────────────────────
  const lockedRooms: LockedRoomRepository = {
    async list({ filter, page, pageSize }) {
      let rows = Array.from(lockedRoomStore.values());
      if (filter?.semesterId !== undefined) rows = rows.filter((r) => r.semesterId === filter.semesterId);
      if (filter?.offeringId !== undefined) rows = rows.filter((r) => r.offeringId === filter.offeringId);
      if (filter?.roomId !== undefined) rows = rows.filter((r) => r.roomId === filter.roomId);
      rows.sort((a, b) => b.lockedAt.getTime() - a.lockedAt.getTime());
      const total = rows.length;
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize).map(clone), total };
    },
    async findById(id) {
      const r = lockedRoomStore.get(id);
      return r ? clone(r) : null;
    },
    async create(input) {
      for (const r of lockedRoomStore.values()) {
        if (r.offeringId === input.offeringId) throw prismaUnique();
      }
      const id = nextLockedRoomId++;
      const row: LockedRoomRecord = {
        id,
        semesterId: input.semesterId,
        offeringId: input.offeringId,
        roomId: input.roomId,
        lockedById: input.lockedById,
        lockedAt: new Date(),
        reason: input.reason ?? null,
      };
      lockedRoomStore.set(id, row);
      return clone(row);
    },
    async update(id, patch) {
      const r = lockedRoomStore.get(id);
      if (!r) throw prismaNotFound();
      if (patch.roomId !== undefined) r.roomId = patch.roomId;
      if (patch.reason !== undefined) r.reason = patch.reason;
      return clone(r);
    },
    async delete(id) {
      if (!lockedRoomStore.has(id)) throw prismaNotFound();
      lockedRoomStore.delete(id);
    },
    async hasRunningScheduleRunForSemester(semesterId) {
      return runningScheduleRunSemesters.has(semesterId);
    },
  };

  // ── Lecturers ───────────────────────────────────────────────────────────
  const lecturers: LecturerRepository = {
    async list({ filter, page, pageSize, sort }) {
      let rows = Array.from(lecturerStore.values());
      if (filter?.semesterId !== undefined) {
        rows = rows.filter((r) => r.semesterId === filter.semesterId);
      }
      if (filter?.isStructural !== undefined) {
        rows = rows.filter((r) => r.isStructural === filter.isStructural);
      }
      if (sort) {
        // Match repo: only `createdAt` and `name` are sortable; default desc
        // by createdAt.
        const tokens = sort.split(',').map((s) => s.trim()).filter(Boolean);
        const cmps: ((a: LecturerRecord, b: LecturerRecord) => number)[] = [];
        for (const token of tokens) {
          const dir = token.startsWith('-') ? -1 : 1;
          const field = token.replace(/^[-+]/, '');
          if (field === 'createdAt') {
            cmps.push((a, b) => dir * (a.createdAt.getTime() - b.createdAt.getTime()));
          } else if (field === 'name') {
            cmps.push((a, b) => dir * a.name.localeCompare(b.name));
          }
        }
        if (cmps.length > 0) {
          rows.sort((a, b) => {
            for (const cmp of cmps) {
              const v = cmp(a, b);
              if (v !== 0) return v;
            }
            return 0;
          });
        } else {
          rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
      } else {
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      const total = rows.length;
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize).map(clone), total };
    },
    async findById(id) {
      const r = lecturerStore.get(id);
      return r ? clone(r) : null;
    },
    async create(input) {
      if (!semesterStore.has(input.semesterId)) throw prismaForeignKey();
      // Mirror repo: validate preferredTimeSlotIds → if any missing, FK error.
      for (const tsId of input.preferredTimeSlotIds) {
        if (!timeSlotStore.has(tsId)) throw prismaForeignKey();
      }
      const now = new Date();
      const id = nextLecturerId++;
      const row: LecturerRecord = {
        id,
        semesterId: input.semesterId,
        name: input.name,
        isStructural: input.isStructural,
        maxSks: input.maxSks ?? (input.isStructural ? 6 : 12),
        preferredTimeSlotIds: [...input.preferredTimeSlotIds],
        competencies: [...input.competencies],
        createdById: input.createdById,
        createdAt: now,
        updatedAt: now,
      };
      lecturerStore.set(id, row);
      return clone(row);
    },
    async update(id, patch) {
      const r = lecturerStore.get(id);
      if (!r) throw prismaNotFound();
      if (patch.preferredTimeSlotIds !== undefined) {
        for (const tsId of patch.preferredTimeSlotIds) {
          if (!timeSlotStore.has(tsId)) throw prismaForeignKey();
        }
        r.preferredTimeSlotIds = [...patch.preferredTimeSlotIds];
      }
      if (patch.name !== undefined) r.name = patch.name;
      if (patch.isStructural !== undefined) r.isStructural = patch.isStructural;
      if (patch.maxSks !== undefined) r.maxSks = patch.maxSks;
      if (patch.competencies !== undefined) r.competencies = [...patch.competencies];
      r.updatedAt = new Date();
      return clone(r);
    },
    async delete(id) {
      if (!lecturerStore.has(id)) throw prismaNotFound();
      // Mirror onDelete: Restrict via CourseOfferingLecturer → if any offering
      // references this lecturer, throw P2003.
      for (const o of courseOfferingStore.values()) {
        if (o.lecturerIds.includes(id)) throw prismaForeignKey();
      }
      lecturerStore.delete(id);
    },
    async hasOfferingReferences(id) {
      for (const o of courseOfferingStore.values()) {
        if (o.lecturerIds.includes(id)) return true;
      }
      return false;
    },
  };

  // ── Courses ─────────────────────────────────────────────────────────────
  function resolveCourseFacilities(codes: string[]): void {
    const known = new Set(Array.from(facilityStore.values()).map((f) => f.code));
    const missing = codes.filter((c) => !known.has(c));
    if (missing.length > 0) throw new UnknownFacilityCodeError(missing);
  }
  const courses: CourseRepository = {
    async list({ filter, page, pageSize }) {
      let rows = Array.from(courseStore.values());
      if (filter?.semesterId !== undefined) {
        rows = rows.filter((r) => r.semesterId === filter.semesterId);
      }
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const total = rows.length;
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize).map(clone), total };
    },
    async findById(id) {
      const r = courseStore.get(id);
      return r ? clone(r) : null;
    },
    async create(input) {
      resolveCourseFacilities(input.requiredFacilities);
      // Schema unique on (semesterId, code).
      for (const r of courseStore.values()) {
        if (r.semesterId === input.semesterId && r.code === input.code) throw prismaUnique();
      }
      if (!semesterStore.has(input.semesterId)) throw prismaForeignKey();
      const now = new Date();
      const id = nextCourseId++;
      const row: CourseRecord = {
        id,
        semesterId: input.semesterId,
        code: input.code,
        name: input.name,
        sks: input.sks,
        requiredFacilities: [...input.requiredFacilities],
        requiredCompetencies: [...input.requiredCompetencies],
        createdById: input.createdById,
        createdAt: now,
        updatedAt: now,
      };
      courseStore.set(id, row);
      return clone(row);
    },
    async update(id, patch) {
      const r = courseStore.get(id);
      if (!r) throw prismaNotFound();
      if (patch.requiredFacilities !== undefined) {
        resolveCourseFacilities(patch.requiredFacilities);
        r.requiredFacilities = [...patch.requiredFacilities];
      }
      if (patch.code !== undefined) {
        for (const other of courseStore.values()) {
          if (other.id !== id && other.semesterId === r.semesterId && other.code === patch.code) {
            throw prismaUnique();
          }
        }
        r.code = patch.code;
      }
      if (patch.name !== undefined) r.name = patch.name;
      if (patch.sks !== undefined) r.sks = patch.sks;
      if (patch.requiredCompetencies !== undefined) {
        r.requiredCompetencies = [...patch.requiredCompetencies];
      }
      r.updatedAt = new Date();
      return clone(r);
    },
    async delete(id) {
      if (!courseStore.has(id)) throw prismaNotFound();
      for (const o of courseOfferingStore.values()) {
        if (o.courseId === id) throw prismaForeignKey();
      }
      courseStore.delete(id);
    },
    async hasOfferingReferences(id) {
      for (const o of courseOfferingStore.values()) {
        if (o.courseId === id) return true;
      }
      return false;
    },
  };

  // ── CourseOfferings ─────────────────────────────────────────────────────
  const courseOfferings: CourseOfferingRepository = {
    async list({ filter, page, pageSize }) {
      let rows = Array.from(courseOfferingStore.values());
      if (filter?.semesterId !== undefined) {
        rows = rows.filter((r) => r.semesterId === filter.semesterId);
      }
      if (filter?.courseId !== undefined) {
        rows = rows.filter((r) => r.courseId === filter.courseId);
      }
      if (filter?.roomId !== undefined) {
        rows = rows.filter((r) => r.roomId === filter.roomId);
      }
      if (filter?.lecturerId !== undefined) {
        rows = rows.filter((r) => r.lecturerIds.includes(filter.lecturerId!));
      }
      if (filter?.parentOfferingId !== undefined) {
        rows = rows.filter((r) => r.parentOfferingId === filter.parentOfferingId);
      }
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const total = rows.length;
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize).map(clone), total };
    },
    async findById(id) {
      const r = courseOfferingStore.get(id);
      return r ? clone(r) : null;
    },
    async create(input) {
      if (!semesterStore.has(input.semesterId)) throw prismaForeignKey();
      if (!courseStore.has(input.courseId)) throw prismaForeignKey();
      if (input.roomId !== null && !roomStore.has(input.roomId)) throw prismaForeignKey();
      for (const lid of input.lecturerIds) {
        if (!lecturerStore.has(lid)) throw prismaForeignKey();
      }
      for (const tsid of input.fixedTimeSlotIds) {
        if (!timeSlotStore.has(tsid)) throw prismaForeignKey();
      }
      if (input.parentOfferingId !== null && !courseOfferingStore.has(input.parentOfferingId)) {
        throw prismaForeignKey();
      }
      const now = new Date();
      const id = nextCourseOfferingId++;
      const row: CourseOfferingRecord = {
        id,
        semesterId: input.semesterId,
        courseId: input.courseId,
        roomId: input.roomId,
        effectiveStudentCount: input.effectiveStudentCount,
        lecturerIds: [...input.lecturerIds],
        isFixed: input.isFixed,
        fixedTimeSlotIds: [...input.fixedTimeSlotIds],
        parentOfferingId: input.parentOfferingId,
        createdById: input.createdById,
        createdAt: now,
        updatedAt: now,
      };
      courseOfferingStore.set(id, row);
      return clone(row);
    },
    async update(id, patch) {
      const r = courseOfferingStore.get(id);
      if (!r) throw prismaNotFound();
      if (patch.lecturerIds !== undefined) {
        for (const lid of patch.lecturerIds) {
          if (!lecturerStore.has(lid)) throw prismaForeignKey();
        }
        r.lecturerIds = [...patch.lecturerIds];
      }
      if (patch.fixedTimeSlotIds !== undefined) {
        for (const tsid of patch.fixedTimeSlotIds) {
          if (!timeSlotStore.has(tsid)) throw prismaForeignKey();
        }
        r.fixedTimeSlotIds = [...patch.fixedTimeSlotIds];
      }
      if (patch.courseId !== undefined) {
        if (!courseStore.has(patch.courseId)) throw prismaForeignKey();
        r.courseId = patch.courseId;
      }
      if (patch.roomId !== undefined) {
        if (patch.roomId !== null && !roomStore.has(patch.roomId)) throw prismaForeignKey();
        r.roomId = patch.roomId;
      }
      if (patch.effectiveStudentCount !== undefined) {
        r.effectiveStudentCount = patch.effectiveStudentCount;
      }
      if (patch.isFixed !== undefined) r.isFixed = patch.isFixed;
      if (patch.parentOfferingId !== undefined) {
        if (
          patch.parentOfferingId !== null &&
          !courseOfferingStore.has(patch.parentOfferingId)
        ) {
          throw prismaForeignKey();
        }
        r.parentOfferingId = patch.parentOfferingId;
      }
      r.updatedAt = new Date();
      return clone(r);
    },
    async updateStudentCount(id, effectiveStudentCount) {
      const r = courseOfferingStore.get(id);
      if (!r) throw prismaNotFound();
      r.effectiveStudentCount = effectiveStudentCount;
      r.updatedAt = new Date();
      return clone(r);
    },
    async delete(id) {
      if (!courseOfferingStore.has(id)) throw prismaNotFound();
      courseOfferingStore.delete(id);
    },
  };

  // ── ScheduleRuns ────────────────────────────────────────────────────────
  function projectSlim(r: FullScheduleRunRow): ScheduleRunRow {
    return {
      id: r.id,
      semesterId: r.semesterId,
      createdById: r.createdById,
      status: r.status,
      configJson: r.configJson,
      idempotencyKey: r.idempotencyKey,
      createdAt: r.createdAt,
    };
  }
  function projectSummary(r: FullScheduleRunRow): ScheduleRunSummaryRecord {
    return {
      id: r.id,
      semesterId: r.semesterId,
      createdById: r.createdById,
      status: r.status,
      bestFitness: r.bestFitness,
      hardViolations: r.hardViolations,
      softPenalty: r.softPenalty,
      competencyMismatch: r.competencyMismatch,
      loadPenalty: r.loadPenalty,
      capacityShortfallPenalty: r.capacityShortfallPenalty,
      generationsRun: r.generationsRun,
      currentGeneration: r.currentGeneration,
      stagnatedEarly: r.stagnatedEarly,
      durationMs: r.durationMs,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    };
  }

  const scheduleRuns: ScheduleRunRepository = {
    async findByIdempotencyKey(key) {
      for (const r of scheduleRunStore.values()) {
        if (r.idempotencyKey === key) return clone(projectSlim(r));
      }
      return null;
    },
    async countOfferingsForSemester(semesterId) {
      let count = 0;
      for (const o of courseOfferingStore.values()) {
        if (o.semesterId === semesterId) count++;
      }
      return count;
    },
    async create(input: CreateScheduleRunInput) {
      // Mirror the unique constraint on idempotencyKey so the route layer's
      // P2002 fallback can be exercised if a test wants to.
      if (input.idempotencyKey) {
        for (const r of scheduleRunStore.values()) {
          if (r.idempotencyKey === input.idempotencyKey) throw prismaUnique();
        }
      }
      const id = `run-${nextScheduleRunSeq++}`;
      const row: FullScheduleRunRow = {
        id,
        semesterId: input.semesterId,
        createdById: input.createdById,
        status: 'QUEUED',
        configJson: input.configJson,
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: new Date(),
        bestFitness: 0,
        hardViolations: 0,
        softPenalty: 0,
        competencyMismatch: 0,
        loadPenalty: 0,
        capacityShortfallPenalty: 0,
        generationsRun: 0,
        currentGeneration: 0,
        stagnatedEarly: false,
        durationMs: null,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        preGASummaryJson: null,
        ssaResultJson: null,
        historyJson: '[]',
        avgHistoryJson: '[]',
      };
      scheduleRunStore.set(id, row);
      return clone(projectSlim(row));
    },
    async markFailed(id, errorCode, errorMessage) {
      const r = scheduleRunStore.get(id);
      if (!r) throw prismaNotFound();
      r.status = 'FAILED';
      r.errorCode = errorCode;
      r.errorMessage = errorMessage;
      r.completedAt = new Date();
    },
    async list({ filter, page, pageSize, sort }) {
      let rows = Array.from(scheduleRunStore.values());
      if (filter?.status !== undefined) rows = rows.filter((r) => r.status === filter.status);
      if (filter?.semesterId !== undefined) rows = rows.filter((r) => r.semesterId === filter.semesterId);
      if (filter?.createdById !== undefined) rows = rows.filter((r) => r.createdById === filter.createdById);

      // Mirror parseSort in the real repo: support a small allow-list.
      const SORTABLE = new Set(['createdAt', 'completedAt', 'startedAt', 'bestFitness', 'durationMs', 'status']);
      if (sort) {
        const tokens = sort.split(',').map((s) => s.trim()).filter(Boolean);
        const cmps: ((a: FullScheduleRunRow, b: FullScheduleRunRow) => number)[] = [];
        for (const token of tokens) {
          const dir = token.startsWith('-') ? -1 : 1;
          const field = token.replace(/^[-+]/, '');
          if (!SORTABLE.has(field)) continue;
          cmps.push((a, b) => {
            const av = (a as unknown as Record<string, unknown>)[field];
            const bv = (b as unknown as Record<string, unknown>)[field];
            if (av instanceof Date || bv instanceof Date) {
              const at = av instanceof Date ? av.getTime() : 0;
              const bt = bv instanceof Date ? bv.getTime() : 0;
              return dir * (at - bt);
            }
            if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
            return dir * String(av).localeCompare(String(bv));
          });
        }
        if (cmps.length > 0) {
          rows.sort((a, b) => {
            for (const cmp of cmps) {
              const v = cmp(a, b);
              if (v !== 0) return v;
            }
            return 0;
          });
        } else {
          rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
      } else {
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }

      const total = rows.length;
      const sliced = rows.slice((page - 1) * pageSize, page * pageSize);
      return { rows: sliced.map((r) => clone(projectSummary(r))), total };
    },
    async findDetailById(id) {
      const r = scheduleRunStore.get(id);
      return r ? clone(r) : null;
    },
    async findAssignments(runId) {
      const rows: Array<ScheduleRunAssignmentDetail & { runId: string }> = [];
      for (const a of scheduleAssignmentStore.values()) {
        if (a.runId === runId) rows.push(a);
      }
      rows.sort((a, b) => {
        if (a.offeringId !== b.offeringId) return a.offeringId - b.offeringId;
        return a.sessionIndex - b.sessionIndex;
      });
      return rows.map((a) => {
        const { runId: _runId, ...rest } = a;
        return clone(rest);
      });
    },
    async delete(id) {
      if (!scheduleRunStore.has(id)) throw prismaNotFound();
      scheduleRunStore.delete(id);
      // Cascade cleanup for joined assignment rows so subsequent
      // findAssignments doesn't return orphans.
      for (const [aid, a] of scheduleAssignmentStore) {
        if (a.runId === id) scheduleAssignmentStore.delete(aid);
      }
    },
    async countAssignmentsByOfferingId(offeringId) {
      const seen = new Set<string>();
      for (const a of scheduleAssignmentStore.values()) {
        if (a.offeringId === offeringId) seen.add(a.runId);
      }
      return { runIds: Array.from(seen) };
    },
    async findAssignmentById(id) {
      const a = scheduleAssignmentStore.get(id);
      if (!a) return null;
      const run = scheduleRunStore.get(a.runId);
      if (!run) return null;
      return {
        id: a.id,
        runId: a.runId,
        offeringId: a.offeringId,
        sessionIndex: a.sessionIndex,
        roomId: a.roomId,
        isFixedRoom: a.isFixedRoom,
        manualOverride: a.manualOverride,
        overriddenById: null,
        overriddenAt: null,
        notes: null,
        timeSlotIds: a.slots.map((s) => s.id),
        lecturerIds: [...a.lecturerIds],
        run: { createdById: run.createdById, status: run.status },
      };
    },
    async overrideAssignment(id, input) {
      const a = scheduleAssignmentStore.get(id);
      if (!a) throw prismaNotFound();
      const run = scheduleRunStore.get(a.runId);
      if (!run) throw prismaNotFound();
      if (input.roomId !== undefined) {
        if (!roomStore.has(input.roomId)) throw prismaForeignKey();
        a.roomId = input.roomId;
      }
      if (input.timeSlotIds !== undefined) {
        for (const timeSlotId of input.timeSlotIds) {
          if (!timeSlotStore.has(timeSlotId)) throw prismaForeignKey();
        }
        a.slots = input.timeSlotIds.map((timeSlotId) => {
          const slot = timeSlotStore.get(timeSlotId)!;
          return {
            id: slot.id,
            day: slot.day,
            startTime: slot.startTime,
            endTime: slot.endTime,
          };
        });
      }
      if (input.lecturerIds !== undefined) {
        for (const lecturerId of input.lecturerIds) {
          if (!lecturerStore.has(lecturerId)) throw prismaForeignKey();
        }
        a.lecturerIds = [...input.lecturerIds];
      }
      a.manualOverride = true;
      return {
        id: a.id,
        runId: a.runId,
        offeringId: a.offeringId,
        sessionIndex: a.sessionIndex,
        roomId: a.roomId,
        isFixedRoom: a.isFixedRoom,
        manualOverride: a.manualOverride,
        overriddenById: input.overriddenById,
        overriddenAt: new Date(),
        notes: input.notes ?? null,
        timeSlotIds: a.slots.map((s) => s.id),
        lecturerIds: [...a.lecturerIds],
        run: { createdById: run.createdById, status: run.status },
      };
    },
  };

  // ── AuditLogs ───────────────────────────────────────────────────────────
  const auditLogs: AuditLogRepository = {
    async create(input: CreateAuditLogInput) {
      if (auditLogFail.active) {
        throw new Error('audit-log persistence simulated failure');
      }
      const metadataJson =
        input.metadata === null || input.metadata === undefined
          ? null
          : JSON.stringify(input.metadata);
      const row: AuditLogRecord = {
        id: nextAuditLogId++,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: metadataJson,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        createdAt: new Date(),
      };
      auditLogStore.push(row);
      return clone(row);
    },
  };

  // ── Seeders ─────────────────────────────────────────────────────────────
  function insertUser(u: Partial<UserRecord> & {
    email: string;
    passwordHash?: string;
    fullName: string;
    role?: Role;
  }): UserRecord {
    const now = new Date();
    const id = u.id ?? nextUserId++;
    const row: UserRecord = {
      id,
      email: u.email,
      passwordHash: u.passwordHash ?? 'noop',
      fullName: u.fullName,
      role: u.role ?? 'USER',
      isActive: u.isActive ?? true,
      lastLoginAt: u.lastLoginAt ?? null,
      createdAt: u.createdAt ?? now,
      updatedAt: u.updatedAt ?? now,
    };
    userStore.set(id, row);
    if (id >= nextUserId) nextUserId = id + 1;
    return clone(row);
  }
  function insertSemester(s: Partial<SemesterRecord> & { code: string; label: string }): SemesterRecord {
    const now = new Date();
    const id = s.id ?? nextSemesterId++;
    const row: SemesterRecord = {
      id,
      code: s.code,
      label: s.label,
      startsOn: s.startsOn ?? new Date('2025-09-01T00:00:00Z'),
      endsOn: s.endsOn ?? new Date('2026-01-31T00:00:00Z'),
      isActive: s.isActive ?? false,
      createdAt: s.createdAt ?? now,
      updatedAt: s.updatedAt ?? now,
    };
    semesterStore.set(id, row);
    if (id >= nextSemesterId) nextSemesterId = id + 1;
    return clone(row);
  }
  function insertRoom(r: Partial<RoomRecord> & { semesterId: number; name: string; capacity: number }): RoomRecord {
    const now = new Date();
    const id = r.id ?? nextRoomId++;
    const row: RoomRecord = {
      id,
      semesterId: r.semesterId,
      name: r.name,
      capacity: r.capacity,
      facilities: r.facilities ?? [],
      createdAt: r.createdAt ?? now,
      updatedAt: r.updatedAt ?? now,
    };
    roomStore.set(id, row);
    if (id >= nextRoomId) nextRoomId = id + 1;
    return clone(row);
  }
  function insertTimeSlot(t: Partial<TimeSlotRecord> & {
    semesterId: number;
    day: Weekday;
    startTime: string;
    endTime: string;
  }): TimeSlotRecord {
    const id = t.id ?? nextTimeSlotId++;
    const row: TimeSlotRecord = {
      id,
      semesterId: t.semesterId,
      day: t.day,
      startTime: t.startTime,
      endTime: t.endTime,
    };
    timeSlotStore.set(id, row);
    if (id >= nextTimeSlotId) nextTimeSlotId = id + 1;
    return clone(row);
  }
  function insertFacility(f: Partial<FacilityRecord> & { code: string; label: string }): FacilityRecord {
    const id = f.id ?? nextFacilityId++;
    const row: FacilityRecord = { id, code: f.code, label: f.label };
    facilityStore.set(id, row);
    if (id >= nextFacilityId) nextFacilityId = id + 1;
    return clone(row);
  }
  function insertLockedRoom(l: Partial<LockedRoomRecord> & {
    semesterId: number;
    offeringId: number;
    roomId: number;
    lockedById: number;
  }): LockedRoomRecord {
    const id = l.id ?? nextLockedRoomId++;
    const row: LockedRoomRecord = {
      id,
      semesterId: l.semesterId,
      offeringId: l.offeringId,
      roomId: l.roomId,
      lockedById: l.lockedById,
      lockedAt: l.lockedAt ?? new Date(),
      reason: l.reason ?? null,
    };
    lockedRoomStore.set(id, row);
    if (id >= nextLockedRoomId) nextLockedRoomId = id + 1;
    return clone(row);
  }
  function insertLecturer(l: Partial<LecturerRecord> & {
    semesterId: number;
    name: string;
  }): LecturerRecord {
    const now = new Date();
    const id = l.id ?? nextLecturerId++;
    const isStructural = l.isStructural ?? false;
    const row: LecturerRecord = {
      id,
      semesterId: l.semesterId,
      name: l.name,
      isStructural,
      maxSks: l.maxSks ?? (isStructural ? 6 : 12),
      preferredTimeSlotIds: l.preferredTimeSlotIds ?? [],
      competencies: l.competencies ?? [],
      createdById: l.createdById ?? null,
      createdAt: l.createdAt ?? now,
      updatedAt: l.updatedAt ?? now,
    };
    lecturerStore.set(id, row);
    if (id >= nextLecturerId) nextLecturerId = id + 1;
    return clone(row);
  }
  function insertCourse(c: Partial<CourseRecord> & {
    semesterId: number;
    code: string;
    name: string;
    sks: number;
  }): CourseRecord {
    const now = new Date();
    const id = c.id ?? nextCourseId++;
    const row: CourseRecord = {
      id,
      semesterId: c.semesterId,
      code: c.code,
      name: c.name,
      sks: c.sks,
      requiredFacilities: c.requiredFacilities ?? [],
      requiredCompetencies: c.requiredCompetencies ?? [],
      createdById: c.createdById ?? null,
      createdAt: c.createdAt ?? now,
      updatedAt: c.updatedAt ?? now,
    };
    courseStore.set(id, row);
    if (id >= nextCourseId) nextCourseId = id + 1;
    return clone(row);
  }
  function insertCourseOffering(o: Partial<CourseOfferingRecord> & {
    semesterId: number;
    courseId: number;
    roomId: number;
    effectiveStudentCount: number;
  }): CourseOfferingRecord {
    const now = new Date();
    const id = o.id ?? nextCourseOfferingId++;
    const row: CourseOfferingRecord = {
      id,
      semesterId: o.semesterId,
      courseId: o.courseId,
      roomId: o.roomId,
      effectiveStudentCount: o.effectiveStudentCount,
      lecturerIds: o.lecturerIds ?? [],
      isFixed: o.isFixed ?? false,
      fixedTimeSlotIds: o.fixedTimeSlotIds ?? [],
      parentOfferingId: o.parentOfferingId ?? null,
      createdById: o.createdById ?? null,
      createdAt: o.createdAt ?? now,
      updatedAt: o.updatedAt ?? now,
    };
    courseOfferingStore.set(id, row);
    if (id >= nextCourseOfferingId) nextCourseOfferingId = id + 1;
    return clone(row);
  }
  function insertScheduleRun(r: Partial<FullScheduleRunRow> & {
    id: string;
    semesterId: number;
    createdById: number;
  }): FullScheduleRunRow {
    const row: FullScheduleRunRow = {
      id: r.id,
      semesterId: r.semesterId,
      createdById: r.createdById,
      status: r.status ?? 'COMPLETED',
      configJson: r.configJson ?? '{}',
      idempotencyKey: r.idempotencyKey ?? null,
      createdAt: r.createdAt ?? new Date(),
      bestFitness: r.bestFitness ?? 0,
      hardViolations: r.hardViolations ?? 0,
      softPenalty: r.softPenalty ?? 0,
      competencyMismatch: r.competencyMismatch ?? 0,
      loadPenalty: r.loadPenalty ?? 0,
      capacityShortfallPenalty: r.capacityShortfallPenalty ?? 0,
      generationsRun: r.generationsRun ?? 0,
      currentGeneration: r.currentGeneration ?? 0,
      stagnatedEarly: r.stagnatedEarly ?? false,
      durationMs: r.durationMs ?? null,
      errorCode: r.errorCode ?? null,
      errorMessage: r.errorMessage ?? null,
      startedAt: r.startedAt ?? null,
      completedAt: r.completedAt ?? null,
      preGASummaryJson: r.preGASummaryJson ?? null,
      ssaResultJson: r.ssaResultJson ?? null,
      historyJson: r.historyJson ?? '[]',
      avgHistoryJson: r.avgHistoryJson ?? '[]',
    };
    scheduleRunStore.set(row.id, row);
    return clone(row);
  }
  function insertScheduleAssignment(
    a: Partial<ScheduleRunAssignmentDetail> & {
      id: number;
      runId: string;
      offeringId: number;
      roomId: number;
    },
  ): ScheduleRunAssignmentDetail & { runId: string } {
    const row: ScheduleRunAssignmentDetail & { runId: string } = {
      runId: a.runId,
      id: a.id,
      offeringId: a.offeringId,
      sessionIndex: a.sessionIndex ?? 0,
      roomId: a.roomId,
      isFixedRoom: a.isFixedRoom ?? false,
      manualOverride: a.manualOverride ?? false,
      lecturerIds: a.lecturerIds ?? [],
      slots: a.slots ?? [],
      offering: a.offering ?? {
        id: a.offeringId,
        courseCode: 'IF000',
        courseName: 'Course',
        lecturers: [],
      },
    };
    scheduleAssignmentStore.set(row.id, row);
    return clone(row);
  }

  return {
    repos: {
      users,
      semesters,
      rooms,
      timeSlots,
      facilities,
      lockedRooms,
      lecturers,
      courses,
      courseOfferings,
      auditLogs,
      scheduleRuns,
    },
    userStore,
    semesterStore,
    roomStore,
    timeSlotStore,
    facilityStore,
    lockedRoomStore,
    lecturerStore,
    courseStore,
    courseOfferingStore,
    scheduleRunStore,
    scheduleAssignmentStore,
    auditLogStore,
    auditLogFail,
    runningScheduleRunSemesters,
    insertUser,
    insertSemester,
    insertRoom,
    insertTimeSlot,
    insertFacility,
    insertLockedRoom,
    insertLecturer,
    insertCourse,
    insertCourseOffering,
    insertScheduleRun,
    insertScheduleAssignment,
  };
}
