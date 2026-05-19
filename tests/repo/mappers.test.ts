/**
 * Unit tests for the pure row→domain mappers under `src/repo/mappers/`.
 *
 * These tests do NOT spin up Prisma; each row is hand-built to mirror the
 * shape Prisma would return for the corresponding `include` block. The
 * `loadScheduleInputs` facade in `src/repo/scheduleRepo.ts` is intentionally
 * out of scope here — it requires a live database and is covered under
 * Phase 5 backlog item 1.
 */

import { describe, it, expect } from "vitest";

import type { Course, Lecturer, Room } from "../../src/types";
import {
  mapRoomRow,
  mapTimeSlotRow,
  weekdayToString,
  mapLecturerRow,
  mapCourseRow,
  mapCourseOfferingRow,
  mapLockedRoomRow,
} from "../../src/repo";

describe("mapRoomRow", () => {
  it("resolves facilities from the join and preserves capacity / name", () => {
    const room = mapRoomRow({
      id: 1,
      name: "TR-1",
      capacity: 30,
      facilities: [
        { facility: { code: "PROJECTOR" } },
        { facility: { code: "LAB" } },
      ],
    });
    expect(room.id).toBe(1);
    expect(room.name).toBe("TR-1");
    expect(room.capacity).toBe(30);
    expect(room.facilities).toEqual(["PROJECTOR", "LAB"]);
  });

  it("returns an empty facilities array when the join is empty", () => {
    const room = mapRoomRow({
      id: 2,
      name: "TR-EMPTY",
      capacity: 50,
      facilities: [],
    });
    expect(room.facilities).toEqual([]);
  });

  it("throws when a facility join row is missing facility.code", () => {
    expect(() =>
      mapRoomRow({
        id: 3,
        name: "BROKEN",
        capacity: 10,
        // @ts-expect-error — intentionally malformed for the test.
        facilities: [{ facility: {} }],
      }),
    ).toThrow(/missing or empty facility\.code/);
  });
});

describe("mapTimeSlotRow / weekdayToString", () => {
  it('translates MONDAY → "Monday"', () => {
    expect(weekdayToString("MONDAY")).toBe("Monday");
  });

  it('translates WEDNESDAY → "Wednesday"', () => {
    expect(weekdayToString("WEDNESDAY")).toBe("Wednesday");
  });

  it("translates every Weekday enum value to its title-case form", () => {
    const expected: Record<string, string> = {
      MONDAY: "Monday",
      TUESDAY: "Tuesday",
      WEDNESDAY: "Wednesday",
      THURSDAY: "Thursday",
      FRIDAY: "Friday",
      SATURDAY: "Saturday",
      SUNDAY: "Sunday",
    };
    for (const [input, output] of Object.entries(expected)) {
      expect(weekdayToString(input)).toBe(output);
    }
  });

  it("throws on an unrecognized Weekday value", () => {
    expect(() => weekdayToString("FUNDAY")).toThrow(/Unrecognized Weekday/);
  });

  it("maps a full TimeSlot row preserving start / end times", () => {
    const slot = mapTimeSlotRow({
      id: 7,
      day: "TUESDAY",
      startTime: "10:00",
      endTime: "11:40",
    });
    expect(slot).toEqual({
      id: 7,
      day: "Tuesday",
      startTime: "10:00",
      endTime: "11:40",
    });
  });
});

describe("mapLecturerRow", () => {
  it("resolves preferredTimeSlotIds from the join (postgres array form)", () => {
    const lec = mapLecturerRow({
      id: 11,
      name: "Dr. Andi",
      maxSks: 12,
      isStructural: true,
      competencies: ["algorithms", "databases"],
      preferredSlots: [{ timeSlotId: 1 }, { timeSlotId: 2 }, { timeSlotId: 3 }],
    });
    expect(lec.id).toBe(11);
    expect(lec.name).toBe("Dr. Andi");
    expect(lec.isStructural).toBe(true);
    expect(lec.preferredTimeSlotIds).toEqual([1, 2, 3]);
    expect(lec.competencies).toEqual(["algorithms", "databases"]);
  });

  it("decodes the SQLite JSON-encoded competencies form", () => {
    const lec = mapLecturerRow({
      id: 12,
      name: "Dr. Bambang",
      maxSks: 12,
      isStructural: false,
      competencies: '["ai-ml","computer-vision"]',
      preferredSlots: [],
    });
    expect(lec.competencies).toEqual(["ai-ml", "computer-vision"]);
    expect(lec.preferredTimeSlotIds).toEqual([]);
  });

  it("treats null competencies as an empty array", () => {
    const lec = mapLecturerRow({
      id: 13,
      name: "Dr. Citra",
      maxSks: 12,
      isStructural: false,
      competencies: null,
      preferredSlots: [{ timeSlotId: 9 }],
    });
    expect(lec.competencies).toEqual([]);
    expect(lec.preferredTimeSlotIds).toEqual([9]);
  });
});

describe("mapCourseRow", () => {
  it("resolves requiredFacilities and decodes requiredCompetencies", () => {
    const course = mapCourseRow({
      id: 21,
      code: "IF101",
      name: "Algoritma & Pemrograman",
      sks: 3,
      requiredCompetencies: ["algorithms"],
      requiredFacilities: [{ facility: { code: "LAB" } }],
    });
    expect(course.id).toBe(21);
    expect(course.code).toBe("IF101");
    expect(course.name).toBe("Algoritma & Pemrograman");
    expect(course.sks).toBe(3);
    expect(course.requiredFacilities).toEqual(["LAB"]);
    expect(course.requiredCompetencies).toEqual(["algorithms"]);
  });

  it("decodes the SQLite JSON-encoded requiredCompetencies form", () => {
    const course = mapCourseRow({
      id: 22,
      code: "IF202",
      name: "Basis Data",
      sks: 3,
      requiredCompetencies: '["databases"]',
      requiredFacilities: [],
    });
    expect(course.requiredCompetencies).toEqual(["databases"]);
    expect(course.requiredFacilities).toEqual([]);
  });

  it("throws on a malformed requiredFacilities join row", () => {
    expect(() =>
      mapCourseRow({
        id: 23,
        code: "BAD",
        name: "Bad",
        sks: 1,
        requiredCompetencies: [],
        requiredFacilities: [{ facility: { code: "" } }],
      }),
    ).toThrow(/missing or empty facility\.code/);
  });
});

describe("mapCourseOfferingRow", () => {
  // Shared by-id maps used across the offering tests.
  const room: Room = {
    id: 100,
    name: "TR-1",
    capacity: 30,
    facilities: ["LAB"],
  };
  const lecturerA: Lecturer = {
    id: 200,
    name: "Dr. Andi",
    maxSks: 12,
    isStructural: true,
    preferredTimeSlotIds: [1],
    competencies: ["algorithms"],
  };
  const lecturerB: Lecturer = {
    id: 201,
    name: "Dr. Bambang",
    maxSks: 12,
    isStructural: false,
    preferredTimeSlotIds: [],
    competencies: ["databases"],
  };
  const course: Course = {
    id: 300,
    code: "IF101",
    name: "Algoritma",
    sks: 3,
    requiredFacilities: ["LAB"],
    requiredCompetencies: ["algorithms"],
  };
  const lecturerById = new Map<number, Lecturer>([
    [lecturerA.id, lecturerA],
    [lecturerB.id, lecturerB],
  ]);
  const roomById = new Map<number, Room>([[room.id, room]]);
  const courseById = new Map<number, Course>([[course.id, course]]);

  it("populates nested course / room / lecturers and resolves fixed slots when isFixed=true", () => {
    const off = mapCourseOfferingRow(
      {
        id: 500,
        courseId: course.id,
        roomId: room.id,
        effectiveStudentCount: 25,
        isFixed: true,
        parentOfferingId: null,
        lecturers: [{ lecturerId: lecturerA.id }, { lecturerId: lecturerB.id }],
        fixedSlots: [{ timeSlotId: 1 }, { timeSlotId: 4 }],
      },
      lecturerById,
      roomById,
      courseById,
    );

    expect(off.id).toBe(500);
    expect(off.course).toBe(course);
    expect(off.room).toBe(room);
    expect(off.lecturers).toEqual([lecturerA, lecturerB]);
    expect(off.isFixed).toBe(true);
    expect(off.fixedTimeSlotIds).toBeDefined();
    // Order isn't normatively specified in `src/types.ts`; assert set equality.
    expect(new Set(off.fixedTimeSlotIds!)).toEqual(new Set([1, 4]));
    expect(off.parentOfferingId).toBeUndefined();
  });

  it("omits fixedTimeSlotIds entirely when isFixed=false", () => {
    const off = mapCourseOfferingRow(
      {
        id: 501,
        courseId: course.id,
        roomId: room.id,
        effectiveStudentCount: 20,
        isFixed: false,
        parentOfferingId: null,
        lecturers: [{ lecturerId: lecturerA.id }],
        fixedSlots: [{ timeSlotId: 1 }], // present in row but should be ignored
      },
      lecturerById,
      roomById,
      courseById,
    );

    expect(off.isFixed).toBe(false);
    expect(off.fixedTimeSlotIds).toBeUndefined();
    expect("fixedTimeSlotIds" in off).toBe(false);
  });

  it("passes through parentOfferingId when present", () => {
    const off = mapCourseOfferingRow(
      {
        id: 502,
        courseId: course.id,
        roomId: room.id,
        effectiveStudentCount: 10,
        isFixed: false,
        parentOfferingId: 500,
        lecturers: [],
        fixedSlots: [],
      },
      lecturerById,
      roomById,
      courseById,
    );
    expect(off.parentOfferingId).toBe(500);
  });

  it("throws when a referenced lecturer id is missing from the map", () => {
    expect(() =>
      mapCourseOfferingRow(
        {
          id: 503,
          courseId: course.id,
          roomId: room.id,
          effectiveStudentCount: 25,
          isFixed: false,
          parentOfferingId: null,
          lecturers: [{ lecturerId: 9999 }],
          fixedSlots: [],
        },
        lecturerById,
        roomById,
        courseById,
      ),
    ).toThrow(/Lecturer 9999 referenced by offering 503 not found/);
  });

  it("throws when a referenced room id is missing from the map", () => {
    expect(() =>
      mapCourseOfferingRow(
        {
          id: 504,
          courseId: course.id,
          roomId: 8888,
          effectiveStudentCount: 25,
          isFixed: false,
          parentOfferingId: null,
          lecturers: [],
          fixedSlots: [],
        },
        lecturerById,
        roomById,
        courseById,
      ),
    ).toThrow(/Room 8888 referenced by offering 504 not found/);
  });

  it("throws when a referenced course id is missing from the map", () => {
    expect(() =>
      mapCourseOfferingRow(
        {
          id: 505,
          courseId: 7777,
          roomId: room.id,
          effectiveStudentCount: 25,
          isFixed: false,
          parentOfferingId: null,
          lecturers: [],
          fixedSlots: [],
        },
        lecturerById,
        roomById,
        courseById,
      ),
    ).toThrow(/Course 7777 referenced by offering 505 not found/);
  });
});

describe("mapLockedRoomRow", () => {
  it("round-trips a row preserving lockedAt as Date and reason=null", () => {
    const lockedAt = new Date("2025-09-01T03:14:00Z");
    const lr = mapLockedRoomRow({
      id: 42,
      semesterId: 1,
      offeringId: 600,
      roomId: 100,
      lockedById: 7,
      lockedAt,
      reason: null,
    });
    expect(lr).toEqual({
      id: 42,
      semesterId: 1,
      offeringId: 600,
      roomId: 100,
      lockedById: 7,
      lockedAt,
      reason: null,
    });
    expect(lr.lockedAt).toBeInstanceOf(Date);
  });

  it("preserves a non-null reason verbatim", () => {
    const lr = mapLockedRoomRow({
      id: 43,
      semesterId: 1,
      offeringId: 601,
      roomId: 101,
      lockedById: 7,
      lockedAt: new Date("2025-09-02T08:00:00Z"),
      reason: "Equipment maintenance",
    });
    expect(lr.reason).toBe("Equipment maintenance");
  });
});
