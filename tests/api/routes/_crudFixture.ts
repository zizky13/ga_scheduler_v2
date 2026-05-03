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
import type { CrudRepositories } from '../../../src/api/lib/crudContext';

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
}

export function buildCrudFixture(): CrudFixture {
  let nextUserId = 1;
  let nextSemesterId = 1;
  let nextRoomId = 1;
  let nextTimeSlotId = 1;
  let nextFacilityId = 1;
  let nextLockedRoomId = 1;

  const userStore = new Map<number, UserRecord>();
  const semesterStore = new Map<number, SemesterRecord>();
  const roomStore = new Map<number, RoomRecord>();
  const timeSlotStore = new Map<number, TimeSlotRecord>();
  const facilityStore = new Map<number, FacilityRecord>();
  const lockedRoomStore = new Map<number, LockedRoomRecord>();
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

  return {
    repos: { users, semesters, rooms, timeSlots, facilities, lockedRooms },
    userStore,
    semesterStore,
    roomStore,
    timeSlotStore,
    facilityStore,
    lockedRoomStore,
    runningScheduleRunSemesters,
    insertUser,
    insertSemester,
    insertRoom,
    insertTimeSlot,
    insertFacility,
    insertLockedRoom,
  };
}
