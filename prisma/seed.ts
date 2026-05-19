/**
 * Prisma seed script — Phase 1 backlog item 6.
 *
 * Purpose: bridge the in-memory fixture in `src/db/seed.ts` to a real
 * PostgreSQL database via Prisma. Re-running `npm run db:seed` is a no-op on
 * row counts (every write is an `upsert` keyed on a unique compound).
 *
 * Spec sources:
 *   - docs/api_and_database_design.md §3.5 migration notes (around line 643).
 *   - prisma/schema.prisma — source of truth for column names + unique keys.
 *   - src/db/seed.ts — source data being ported.
 *
 * Usage:
 *   npm run db:seed
 *   npm run db:seed -- --with-infeasible
 *
 * `src/db/seed.ts` itself is intentionally left in place — the legacy CLI
 * runners under `src/cli/` still consume it as an in-memory fixture.
 */

import { PrismaClient, Weekday } from '@prisma/client';
import {
  rooms as seedRooms,
  timeSlots as seedTimeSlots,
  lecturers as seedLecturers,
  courses as seedCourses,
  courseOfferings as seedOfferings,
  infeasibleOfferings as seedInfeasibleOfferings,
} from '../src/db/seed.js';
import type {
  Room as SeedRoom,
  TimeSlot as SeedTimeSlot,
  Lecturer as SeedLecturer,
  Course as SeedCourse,
  CourseOffering as SeedOffering,
} from '../src/types.js';

// ─── Constants ────────────────────────────────────────────────────────────

/** Single semester this seed populates. The `code` is the upsert key. */
export const SEED_SEMESTER = {
  code: '2025-GANJIL',
  label: 'Semester Ganjil 2025/2026',
  // Sensible Indonesian odd-semester window (Aug–Dec); not load-bearing
  // anywhere in the GA core, but populated to satisfy schema NOT NULLs.
  startsOn: new Date('2025-08-01T00:00:00.000Z'),
  endsOn: new Date('2025-12-20T00:00:00.000Z'),
  isActive: true,
} as const;

/** Three facility codes referenced by the seed `facilities` arrays. */
export const SEED_FACILITIES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'LAB', label: 'Computer Laboratory' },
  { code: 'PROJECTOR', label: 'Projector' },
  { code: 'STUDIO', label: 'Design Studio' },
];

/** Map seed.ts day strings ('Monday', ...) to Prisma's Weekday enum. */
const DAY_TO_WEEKDAY: Record<string, Weekday> = {
  Monday: Weekday.MONDAY,
  Tuesday: Weekday.TUESDAY,
  Wednesday: Weekday.WEDNESDAY,
  Thursday: Weekday.THURSDAY,
  Friday: Weekday.FRIDAY,
  Saturday: Weekday.SATURDAY,
  Sunday: Weekday.SUNDAY,
};

function toWeekday(day: string): Weekday {
  const w = DAY_TO_WEEKDAY[day];
  if (!w) throw new Error(`Unknown day '${day}' in seed time slot`);
  return w;
}

// ─── Plan types ───────────────────────────────────────────────────────────

export interface SeedSemesterPlan {
  code: string;
  label: string;
  startsOn: Date;
  endsOn: Date;
  isActive: boolean;
}

export interface SeedRoomPlan {
  seedId: number;
  name: string; // unique within (semesterId, name)
  capacity: number;
  facilities: string[];
}

export interface SeedRoomFacilityLink {
  roomName: string;
  facilityCode: string;
}

export interface SeedTimeSlotPlan {
  seedId: number;
  day: Weekday;
  startTime: string;
  endTime: string;
}

export interface SeedLecturerPlan {
  seedId: number;
  name: string;
  isStructural: boolean;
  competencies: string[];
}

export interface SeedLecturerPreferredSlotLink {
  lecturerName: string;
  // Lookup key for the slot — matches the TimeSlot unique compound.
  day: Weekday;
  startTime: string;
}

export interface SeedCoursePlan {
  seedId: number;
  code: string; // unique within (semesterId, code)
  name: string;
  sks: number;
  requiredCompetencies: string[];
  requiredFacilities: string[];
}

export interface SeedCourseFacilityLink {
  courseCode: string;
  facilityCode: string;
}

export interface SeedOfferingPlan {
  seedId: number;
  courseCode: string;
  roomName: string;
  effectiveStudentCount: number;
  isFixed: boolean;
  // Cross-reference data — resolved to Prisma ids during apply.
  lecturerNames: string[];
  fixedSlotKeys: Array<{ day: Weekday; startTime: string }>;
}

export interface SeedOfferingLecturerLink {
  offeringSeedId: number;
  lecturerName: string;
}

export interface SeedOfferingFixedSlotLink {
  offeringSeedId: number;
  day: Weekday;
  startTime: string;
}

export interface SeedPlan {
  semester: SeedSemesterPlan;
  facilities: ReadonlyArray<{ code: string; label: string }>;
  rooms: SeedRoomPlan[];
  roomFacilities: SeedRoomFacilityLink[];
  timeSlots: SeedTimeSlotPlan[];
  lecturers: SeedLecturerPlan[];
  lecturerPreferredSlots: SeedLecturerPreferredSlotLink[];
  courses: SeedCoursePlan[];
  courseRequiredFacilities: SeedCourseFacilityLink[];
  offerings: SeedOfferingPlan[];
  offeringLecturers: SeedOfferingLecturerLink[];
  offeringFixedSlots: SeedOfferingFixedSlotLink[];
  /** Extra rooms required by infeasible offerings (e.g., capacity-0 BAD-ROOM). */
  infeasibleRooms: SeedRoomPlan[];
  infeasibleOfferings: SeedOfferingPlan[];
  infeasibleOfferingLecturers: SeedOfferingLecturerLink[];
  infeasibleOfferingFixedSlots: SeedOfferingFixedSlotLink[];
}

export interface BuildSeedPlanOptions {
  withInfeasible: boolean;
}

// ─── Pure plan builder (unit-testable, no Prisma) ─────────────────────────

/**
 * Translate the legacy in-memory seed into a structured plan ready for
 * Prisma `upsert` calls. Pure: no I/O, no DB. Exported for unit testing in
 * `tests/db/prismaSeed.test.ts`.
 */
export function buildSeedPlan(
  rooms: SeedRoom[],
  timeSlots: SeedTimeSlot[],
  lecturers: SeedLecturer[],
  courses: SeedCourse[],
  offerings: SeedOffering[],
  infeasibleOfferings: SeedOffering[],
  opts: BuildSeedPlanOptions,
): SeedPlan {
  // Rooms.
  const roomsPlan: SeedRoomPlan[] = rooms.map((r) => ({
    seedId: r.id,
    name: r.name,
    capacity: r.capacity,
    facilities: [...r.facilities],
  }));
  const roomFacilities: SeedRoomFacilityLink[] = [];
  for (const r of rooms) {
    for (const f of r.facilities) {
      roomFacilities.push({ roomName: r.name, facilityCode: f });
    }
  }

  // Time slots.
  const timeSlotsPlan: SeedTimeSlotPlan[] = timeSlots.map((ts) => ({
    seedId: ts.id,
    day: toWeekday(ts.day),
    startTime: ts.startTime,
    endTime: ts.endTime,
  }));

  // Lecturers + their preferred slots (cross-reference by day+startTime).
  const slotById = new Map<number, SeedTimeSlot>();
  for (const ts of timeSlots) slotById.set(ts.id, ts);

  const lecturersPlan: SeedLecturerPlan[] = lecturers.map((l) => ({
    seedId: l.id,
    name: l.name,
    isStructural: l.isStructural,
    competencies: [...l.competencies],
  }));
  const lecturerPreferredSlots: SeedLecturerPreferredSlotLink[] = [];
  for (const l of lecturers) {
    for (const slotId of l.preferredTimeSlotIds) {
      const slot = slotById.get(slotId);
      if (!slot) {
        throw new Error(
          `Lecturer ${l.name} references unknown time slot id ${slotId}`,
        );
      }
      lecturerPreferredSlots.push({
        lecturerName: l.name,
        day: toWeekday(slot.day),
        startTime: slot.startTime,
      });
    }
  }

  // Courses + required facilities.
  const courseById = new Map<number, SeedCourse>();
  for (const c of courses) courseById.set(c.id, c);

  const coursesPlan: SeedCoursePlan[] = courses.map((c) => ({
    seedId: c.id,
    code: c.code,
    name: c.name,
    sks: c.sks,
    requiredCompetencies: [...c.requiredCompetencies],
    requiredFacilities: [...c.requiredFacilities],
  }));
  const courseRequiredFacilities: SeedCourseFacilityLink[] = [];
  for (const c of courses) {
    for (const f of c.requiredFacilities) {
      courseRequiredFacilities.push({ courseCode: c.code, facilityCode: f });
    }
  }

  // Offerings (feasible).
  const offeringsPlan: SeedOfferingPlan[] = [];
  const offeringLecturers: SeedOfferingLecturerLink[] = [];
  const offeringFixedSlots: SeedOfferingFixedSlotLink[] = [];

  for (const o of offerings) {
    const course = courseById.get(o.courseId);
    if (!course) {
      throw new Error(
        `Offering ${o.id} references unknown course id ${o.courseId}`,
      );
    }
    const room = rooms.find((r) => r.id === o.roomId);
    if (!room) {
      throw new Error(
        `Offering ${o.id} references unknown room id ${o.roomId}`,
      );
    }
    const fixedSlotKeys: Array<{ day: Weekday; startTime: string }> = [];
    for (const slotId of o.fixedTimeSlotIds ?? []) {
      const slot = slotById.get(slotId);
      if (!slot) {
        throw new Error(
          `Offering ${o.id} references unknown fixed time slot id ${slotId}`,
        );
      }
      fixedSlotKeys.push({
        day: toWeekday(slot.day),
        startTime: slot.startTime,
      });
      offeringFixedSlots.push({
        offeringSeedId: o.id,
        day: toWeekday(slot.day),
        startTime: slot.startTime,
      });
    }
    const lecturerNames = o.lecturers.map((l) => l.name);
    for (const name of lecturerNames) {
      offeringLecturers.push({ offeringSeedId: o.id, lecturerName: name });
    }
    offeringsPlan.push({
      seedId: o.id,
      courseCode: course.code,
      roomName: room.name,
      effectiveStudentCount: o.effectiveStudentCount,
      isFixed: o.isFixed,
      lecturerNames,
      fixedSlotKeys,
    });
  }

  // Infeasible offerings + the ad-hoc rooms they pull in (e.g., BAD-ROOM).
  const infeasibleRooms: SeedRoomPlan[] = [];
  const infeasibleOfferingsPlan: SeedOfferingPlan[] = [];
  const infeasibleOfferingLecturers: SeedOfferingLecturerLink[] = [];
  const infeasibleOfferingFixedSlots: SeedOfferingFixedSlotLink[] = [];

  if (opts.withInfeasible) {
    const knownRoomNames = new Set(rooms.map((r) => r.name));
    const seenInfeasibleRoomNames = new Set<string>();

    for (const o of infeasibleOfferings) {
      const course = courseById.get(o.courseId);
      if (!course) {
        throw new Error(
          `Infeasible offering ${o.id} references unknown course id ${o.courseId}`,
        );
      }
      // The infeasibleCapacity offering carries an inline `room` not present
      // in the canonical `rooms` array. Detect that by name and add it as an
      // additional Prisma room (still scoped to the same semester).
      if (!knownRoomNames.has(o.room.name)) {
        if (!seenInfeasibleRoomNames.has(o.room.name)) {
          seenInfeasibleRoomNames.add(o.room.name);
          infeasibleRooms.push({
            seedId: o.room.id,
            name: o.room.name,
            capacity: o.room.capacity,
            facilities: [...o.room.facilities],
          });
        }
      }
      const fixedSlotKeys: Array<{ day: Weekday; startTime: string }> = [];
      for (const slotId of o.fixedTimeSlotIds ?? []) {
        const slot = slotById.get(slotId);
        if (!slot) continue;
        fixedSlotKeys.push({
          day: toWeekday(slot.day),
          startTime: slot.startTime,
        });
        infeasibleOfferingFixedSlots.push({
          offeringSeedId: o.id,
          day: toWeekday(slot.day),
          startTime: slot.startTime,
        });
      }
      const lecturerNames = o.lecturers.map((l) => l.name);
      for (const name of lecturerNames) {
        infeasibleOfferingLecturers.push({
          offeringSeedId: o.id,
          lecturerName: name,
        });
      }
      infeasibleOfferingsPlan.push({
        seedId: o.id,
        courseCode: course.code,
        roomName: o.room.name,
        effectiveStudentCount: o.effectiveStudentCount,
        isFixed: o.isFixed,
        lecturerNames,
        fixedSlotKeys,
      });
    }
  }

  return {
    semester: { ...SEED_SEMESTER },
    facilities: SEED_FACILITIES,
    rooms: roomsPlan,
    roomFacilities,
    timeSlots: timeSlotsPlan,
    lecturers: lecturersPlan,
    lecturerPreferredSlots,
    courses: coursesPlan,
    courseRequiredFacilities,
    offerings: offeringsPlan,
    offeringLecturers,
    offeringFixedSlots,
    infeasibleRooms,
    infeasibleOfferings: infeasibleOfferingsPlan,
    infeasibleOfferingLecturers,
    infeasibleOfferingFixedSlots,
  };
}

// ─── Apply plan against Prisma (real I/O) ─────────────────────────────────

async function applyPlan(prisma: PrismaClient, plan: SeedPlan): Promise<void> {
  // 1. Semester (single row, upsert by code).
  const semester = await prisma.semester.upsert({
    where: { code: plan.semester.code },
    create: {
      code: plan.semester.code,
      label: plan.semester.label,
      startsOn: plan.semester.startsOn,
      endsOn: plan.semester.endsOn,
      isActive: plan.semester.isActive,
    },
    update: {
      label: plan.semester.label,
      startsOn: plan.semester.startsOn,
      endsOn: plan.semester.endsOn,
      isActive: plan.semester.isActive,
    },
  });

  // 2. Facilities (global; upsert by code).
  await prisma.$transaction(
    plan.facilities.map((f) =>
      prisma.facility.upsert({
        where: { code: f.code },
        create: { code: f.code, label: f.label },
        update: { label: f.label },
      }),
    ),
  );
  const facilityRows = await prisma.facility.findMany();
  const facilityIdByCode = new Map<string, number>();
  for (const f of facilityRows) facilityIdByCode.set(f.code, f.id);

  // 3. Rooms (upsert by (semesterId, name)) plus the room→facility joins.
  const allRoomPlans = [...plan.rooms, ...plan.infeasibleRooms];
  await prisma.$transaction(
    allRoomPlans.map((r) =>
      prisma.room.upsert({
        where: {
          semesterId_name: { semesterId: semester.id, name: r.name },
        },
        create: { semesterId: semester.id, name: r.name, capacity: r.capacity },
        update: { capacity: r.capacity },
      }),
    ),
  );
  const roomRows = await prisma.room.findMany({
    where: { semesterId: semester.id },
  });
  const roomIdByName = new Map<string, number>();
  for (const r of roomRows) roomIdByName.set(r.name, r.id);

  // RoomFacility joins: keep idempotent via composite-PK upsert.
  const allRoomFacilityLinks = [
    ...plan.roomFacilities,
    ...plan.infeasibleRooms.flatMap((r) =>
      r.facilities.map((fc) => ({ roomName: r.name, facilityCode: fc })),
    ),
  ];
  await prisma.$transaction(
    allRoomFacilityLinks.map((rf) => {
      const roomId = roomIdByName.get(rf.roomName);
      const facilityId = facilityIdByCode.get(rf.facilityCode);
      if (!roomId || !facilityId) {
        throw new Error(
          `RoomFacility link references missing room=${rf.roomName} or facility=${rf.facilityCode}`,
        );
      }
      return prisma.roomFacility.upsert({
        where: { roomId_facilityId: { roomId, facilityId } },
        create: { roomId, facilityId },
        update: {},
      });
    }),
  );

  // 4. Time slots.
  await prisma.$transaction(
    plan.timeSlots.map((ts) =>
      prisma.timeSlot.upsert({
        where: {
          semesterId_day_startTime_endTime: {
            semesterId: semester.id,
            day: ts.day,
            startTime: ts.startTime,
            endTime: ts.endTime,
          },
        },
        create: {
          semesterId: semester.id,
          day: ts.day,
          startTime: ts.startTime,
          endTime: ts.endTime,
        },
        update: {},
      }),
    ),
  );
  const slotRows = await prisma.timeSlot.findMany({
    where: { semesterId: semester.id },
  });
  const slotIdByKey = new Map<string, number>();
  for (const s of slotRows) {
    slotIdByKey.set(`${s.day}|${s.startTime}`, s.id);
  }

  // 5. Lecturers + their preferred-slot joins. competencies are written as
  //    a native String[] (Postgres). The codec is intentionally bypassed at
  //    write time because Prisma rejects a JSON string written into a
  //    String[] column. If/when OQ-3 flips to SQLite, swap this for the
  //    codec-encoded form.
  //
  //    Lecturer has no declared unique on (semesterId, name) in the schema,
  //    so we emulate idempotency via findFirst + update/create rather than
  //    `prisma.lecturer.upsert`.
  const lecturerIdByName = new Map<string, number>();
  for (const l of plan.lecturers) {
    const existing = await prisma.lecturer.findFirst({
      where: { semesterId: semester.id, name: l.name },
    });
    const row = existing
      ? await prisma.lecturer.update({
          where: { id: existing.id },
          data: {
            isStructural: l.isStructural,
            competencies: l.competencies,
            maxSks: l.isStructural ? 6 : 12,
          },
        })
      : await prisma.lecturer.create({
          data: {
            semesterId: semester.id,
            name: l.name,
            isStructural: l.isStructural,
            competencies: l.competencies,
            maxSks: l.isStructural ? 6 : 12,
          },
        });
    lecturerIdByName.set(l.name, row.id);
  }

  await prisma.$transaction(
    plan.lecturerPreferredSlots.map((lps) => {
      const lecturerId = lecturerIdByName.get(lps.lecturerName);
      const timeSlotId = slotIdByKey.get(`${lps.day}|${lps.startTime}`);
      if (!lecturerId || !timeSlotId) {
        throw new Error(
          `LecturerPreferredSlot references missing lecturer=${lps.lecturerName} or slot=${lps.day}|${lps.startTime}`,
        );
      }
      return prisma.lecturerPreferredSlot.upsert({
        where: { lecturerId_timeSlotId: { lecturerId, timeSlotId } },
        create: { lecturerId, timeSlotId },
        update: {},
      });
    }),
  );

  // 6. Courses + required facility joins.
  await prisma.$transaction(
    plan.courses.map((c) =>
      prisma.course.upsert({
        where: {
          semesterId_code: { semesterId: semester.id, code: c.code },
        },
        create: {
          semesterId: semester.id,
          code: c.code,
          name: c.name,
          sks: c.sks,
          requiredCompetencies: c.requiredCompetencies,
        },
        update: {
          name: c.name,
          sks: c.sks,
          requiredCompetencies: c.requiredCompetencies,
        },
      }),
    ),
  );
  const courseRows = await prisma.course.findMany({
    where: { semesterId: semester.id },
  });
  const courseIdByCode = new Map<string, number>();
  for (const c of courseRows) courseIdByCode.set(c.code, c.id);

  await prisma.$transaction(
    plan.courseRequiredFacilities.map((crf) => {
      const courseId = courseIdByCode.get(crf.courseCode);
      const facilityId = facilityIdByCode.get(crf.facilityCode);
      if (!courseId || !facilityId) {
        throw new Error(
          `CourseRequiredFacility link references missing course=${crf.courseCode} or facility=${crf.facilityCode}`,
        );
      }
      return prisma.courseRequiredFacility.upsert({
        where: { courseId_facilityId: { courseId, facilityId } },
        create: { courseId, facilityId },
        update: {},
      });
    }),
  );

  // 7. Course offerings. CourseOffering has no natural unique compound in
  //    the schema (multiple offerings can share the same course/room), so
  //    we emulate idempotency by keying on (semesterId, courseId, roomId,
  //    effectiveStudentCount, isFixed) — the closest natural fingerprint of
  //    a "section" in the seed dataset. If a row matches, we update its
  //    join tables; otherwise we create.
  const allOfferings = [...plan.offerings, ...plan.infeasibleOfferings];
  const offeringIdBySeedId = new Map<number, number>();
  for (const o of allOfferings) {
    const courseId = courseIdByCode.get(o.courseCode);
    const roomId = roomIdByName.get(o.roomName);
    if (!courseId || !roomId) {
      throw new Error(
        `Offering seedId=${o.seedId} references missing course=${o.courseCode} or room=${o.roomName}`,
      );
    }
    const existing = await prisma.courseOffering.findFirst({
      where: {
        semesterId: semester.id,
        courseId,
        roomId,
        effectiveStudentCount: o.effectiveStudentCount,
        isFixed: o.isFixed,
      },
    });
    const row = existing
      ? await prisma.courseOffering.update({
          where: { id: existing.id },
          data: {
            effectiveStudentCount: o.effectiveStudentCount,
            isFixed: o.isFixed,
          },
        })
      : await prisma.courseOffering.create({
          data: {
            semesterId: semester.id,
            courseId,
            roomId,
            effectiveStudentCount: o.effectiveStudentCount,
            isFixed: o.isFixed,
          },
        });
    offeringIdBySeedId.set(o.seedId, row.id);
  }

  // 8. Offering ↔ lecturer joins.
  const allOfferingLecturers = [
    ...plan.offeringLecturers,
    ...plan.infeasibleOfferingLecturers,
  ];
  await prisma.$transaction(
    allOfferingLecturers.map((ol) => {
      const offeringId = offeringIdBySeedId.get(ol.offeringSeedId);
      const lecturerId = lecturerIdByName.get(ol.lecturerName);
      if (!offeringId || !lecturerId) {
        throw new Error(
          `OfferingLecturer link references missing offering=${ol.offeringSeedId} or lecturer=${ol.lecturerName}`,
        );
      }
      return prisma.courseOfferingLecturer.upsert({
        where: { offeringId_lecturerId: { offeringId, lecturerId } },
        create: { offeringId, lecturerId },
        update: {},
      });
    }),
  );

  // 9. Offering ↔ fixed slot joins.
  const allOfferingFixedSlots = [
    ...plan.offeringFixedSlots,
    ...plan.infeasibleOfferingFixedSlots,
  ];
  await prisma.$transaction(
    allOfferingFixedSlots.map((ofs) => {
      const offeringId = offeringIdBySeedId.get(ofs.offeringSeedId);
      const timeSlotId = slotIdByKey.get(`${ofs.day}|${ofs.startTime}`);
      if (!offeringId || !timeSlotId) {
        throw new Error(
          `OfferingFixedSlot link references missing offering=${ofs.offeringSeedId} or slot=${ofs.day}|${ofs.startTime}`,
        );
      }
      return prisma.courseOfferingFixedSlot.upsert({
        where: { offeringId_timeSlotId: { offeringId, timeSlotId } },
        create: { offeringId, timeSlotId },
        update: {},
      });
    }),
  );
}

// ─── CLI entry point ──────────────────────────────────────────────────────

function parseArgs(argv: string[]): BuildSeedPlanOptions {
  return { withInfeasible: argv.includes('--with-infeasible') };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const plan = buildSeedPlan(
    seedRooms,
    seedTimeSlots,
    seedLecturers,
    seedCourses,
    seedOfferings,
    seedInfeasibleOfferings,
    opts,
  );

  const prisma = new PrismaClient();
  try {
    await applyPlan(prisma, plan);
    const tag = opts.withInfeasible ? ' (with infeasible)' : ' (feasible only)';
    console.log(
      `Seeded ${plan.rooms.length + plan.infeasibleRooms.length} rooms, ` +
        `${plan.timeSlots.length} time slots, ${plan.lecturers.length} lecturers, ` +
        `${plan.courses.length} courses, ` +
        `${plan.offerings.length + plan.infeasibleOfferings.length} offerings${tag}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when invoked as a script — keeps `buildSeedPlan` import-safe for
// unit tests under `tests/db/`.
const isDirectInvocation = (() => {
  // CommonJS path: `require.main === module` is the canonical check, but the
  // file is consumed via tsx, which honors NodeNext. Use `process.argv[1]`
  // path comparison instead — robust under both.
  const entry = process.argv[1] ?? '';
  return entry.endsWith('seed.ts') || entry.endsWith('seed.js');
})();

if (isDirectInvocation) {
  main().catch((err) => {
    console.error('Prisma seed failed:', err);
    process.exitCode = 1;
  });
}
