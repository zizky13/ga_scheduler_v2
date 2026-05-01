/**
 * Unit tests for the pure plan builder behind the Prisma seed script.
 * Intentionally does NOT spin up a database — all assertions run against the
 * in-memory `SeedPlan` object returned by `buildSeedPlan(...)`.
 *
 * Spec sources:
 *   - prisma/seed.ts (Phase 1 backlog item 6)
 *   - src/db/seed.ts (the legacy in-memory fixture being ported)
 */
import { describe, it, expect } from 'vitest';
import { Weekday } from '@prisma/client';
import { buildSeedPlan, SEED_SEMESTER, SEED_FACILITIES } from '../../prisma/seed.js';
import {
  rooms,
  timeSlots,
  lecturers,
  courses,
  courseOfferings,
  infeasibleOfferings,
} from '../../src/db/seed.js';

function makePlan(withInfeasible: boolean) {
  return buildSeedPlan(
    rooms,
    timeSlots,
    lecturers,
    courses,
    courseOfferings,
    infeasibleOfferings,
    { withInfeasible },
  );
}

describe('buildSeedPlan — feasible only', () => {
  const plan = makePlan(false);

  it('produces exactly one semester (2025-GANJIL)', () => {
    expect(plan.semester.code).toBe('2025-GANJIL');
    expect(plan.semester.code).toBe(SEED_SEMESTER.code);
    expect(plan.semester.label).toBe('Semester Ganjil 2025/2026');
    expect(plan.semester.isActive).toBe(true);
    expect(plan.semester.startsOn).toBeInstanceOf(Date);
    expect(plan.semester.endsOn).toBeInstanceOf(Date);
  });

  it('exposes the 3 canonical facilities (LAB / PROJECTOR / STUDIO)', () => {
    expect(plan.facilities).toHaveLength(3);
    const codes = plan.facilities.map((f) => f.code).sort();
    expect(codes).toEqual(['LAB', 'PROJECTOR', 'STUDIO']);
    // Module-level constant should match.
    expect(plan.facilities).toBe(SEED_FACILITIES);
  });

  it('seeds the canonical 6 rooms, 15 time slots, 8 lecturers, 11 courses, 15 offerings', () => {
    expect(plan.rooms).toHaveLength(6);
    expect(plan.timeSlots).toHaveLength(15);
    expect(plan.lecturers).toHaveLength(8);
    expect(plan.courses).toHaveLength(11);
    expect(plan.offerings).toHaveLength(15);
  });

  it('produces zero infeasible entries when withInfeasible=false', () => {
    expect(plan.infeasibleRooms).toHaveLength(0);
    expect(plan.infeasibleOfferings).toHaveLength(0);
    expect(plan.infeasibleOfferingLecturers).toHaveLength(0);
    expect(plan.infeasibleOfferingFixedSlots).toHaveLength(0);
  });

  it("carries Dr. Andi Suryadi's 4 preferred slot tuples (Mon/Tue mornings)", () => {
    const andi = plan.lecturerPreferredSlots.filter(
      (lps) => lps.lecturerName === 'Dr. Andi Suryadi',
    );
    expect(andi).toHaveLength(4);
    const tuples = andi
      .map((lps) => `${lps.day}|${lps.startTime}`)
      .sort();
    // Mon 08:00, Mon 10:00, Tue 08:00, Tue 10:00
    expect(tuples).toEqual([
      `${Weekday.MONDAY}|08:00`,
      `${Weekday.MONDAY}|10:00`,
      `${Weekday.TUESDAY}|08:00`,
      `${Weekday.TUESDAY}|10:00`,
    ]);
  });

  it('IF101 requires LAB facility AND lists `algorithms` competency', () => {
    const if101 = plan.courses.find((c) => c.code === 'IF101');
    expect(if101).toBeDefined();
    expect(if101!.requiredCompetencies).toContain('algorithms');
    expect(if101!.requiredFacilities).toContain('LAB');

    const labLink = plan.courseRequiredFacilities.find(
      (l) => l.courseCode === 'IF101' && l.facilityCode === 'LAB',
    );
    expect(labLink).toBeDefined();
  });

  it('offering 6 (RPL fixed) is fixed with exactly one fixed-slot tuple (Monday, 08:00)', () => {
    const off6 = plan.offerings.find((o) => o.seedId === 6);
    expect(off6).toBeDefined();
    expect(off6!.isFixed).toBe(true);
    expect(off6!.courseCode).toBe('IF301');
    expect(off6!.fixedSlotKeys).toHaveLength(1);
    expect(off6!.fixedSlotKeys[0]).toEqual({
      day: Weekday.MONDAY,
      startTime: '08:00',
    });

    const fixedLink = plan.offeringFixedSlots.find(
      (f) => f.offeringSeedId === 6,
    );
    expect(fixedLink).toBeDefined();
    expect(fixedLink!.day).toBe(Weekday.MONDAY);
    expect(fixedLink!.startTime).toBe('08:00');
  });

  it('every plan entity carries the unique-compound-key fields needed for upsert idempotency', () => {
    // Semester upsert keys on `code`.
    expect(plan.semester).toHaveProperty('code');
    // Room upsert keys on (semesterId, name) — `name` is the per-plan key.
    for (const r of plan.rooms) expect(r.name).toBeTruthy();
    // TimeSlot upsert keys on (semesterId, day, startTime, endTime).
    for (const ts of plan.timeSlots) {
      expect(ts.day).toBeTruthy();
      expect(ts.startTime).toBeTruthy();
      expect(ts.endTime).toBeTruthy();
    }
    // Course upsert keys on (semesterId, code).
    for (const c of plan.courses) expect(c.code).toBeTruthy();
    // Lecturer has no schema-level unique on name; the apply path uses
    // findFirst on (semesterId, name). At minimum each plan row needs name.
    for (const l of plan.lecturers) expect(l.name).toBeTruthy();
    // Offering join lookups need the seedId + courseCode + roomName triplet.
    for (const o of plan.offerings) {
      expect(typeof o.seedId).toBe('number');
      expect(o.courseCode).toBeTruthy();
      expect(o.roomName).toBeTruthy();
    }
  });
});

describe('buildSeedPlan — with --with-infeasible', () => {
  const plan = makePlan(true);

  it('adds the BAD-ROOM and grows offerings to 19 total', () => {
    expect(plan.rooms).toHaveLength(6);
    expect(plan.infeasibleRooms).toHaveLength(1);
    expect(plan.infeasibleRooms[0]!.name).toBe('BAD-ROOM');
    expect(plan.infeasibleRooms[0]!.capacity).toBe(0);

    expect(plan.offerings).toHaveLength(15);
    expect(plan.infeasibleOfferings).toHaveLength(4);
    expect(plan.offerings.length + plan.infeasibleOfferings.length).toBe(19);
  });

  it('does NOT duplicate the canonical rooms / slots / lecturers / courses', () => {
    expect(plan.rooms).toHaveLength(6);
    expect(plan.timeSlots).toHaveLength(15);
    expect(plan.lecturers).toHaveLength(8);
    expect(plan.courses).toHaveLength(11);
  });
});
