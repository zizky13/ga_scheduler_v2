/**
 * Mock data seed for comprehensive layer validation.
 *
 * DESIGN GOALS:
 *   1. Layer 1 (Pre-GA): test all 6 checks + entity tagging
 *      - PASS: 15 feasible offerings
 *      - FAIL: 4 infeasible (facility, capacity, no-lecturer, fixed-no-slots)
 *   2. Layer 2 (SSA): Static Exclusion + AC-3 + Hopcroft-Karp
 *      - Phase 0: 2 fixed offerings lock (R-201, Mon 07:30-10:00) and (R-201, Tue 07:30-10:00)
 *        → flexible R-201 offerings lose those slots from their domain
 *      - Phase 1 & 2: pass for feasible data; exported infeasible test sets
 *   3. Layer 3 (GA): Masked Gene Operators + Soft Constraints
 *      - FIXED genes: offering 6 and 15 → roomId never mutated
 *      - Structural penalty: Eko (structural) teaches 3 offerings → penalty if >2
 *      - Preference penalty: tight prefs ensure gen-1 has non-zero penalty
 *      - Team teaching: offerings 5 and 13 have 2 lecturers
 *
 * Resources: 6 rooms, 15 slots (Mon–Fri × 3/day), 8 lecturers, 11 courses
 * Total sessions: 15 (all single-session)
 * Slot utilization: 15 / (6 rooms × 15 slots) = 17% — feasible but tight on shared rooms
 */

import type {
  Room,
  TimeSlot,
  Lecturer,
  Course,
  CourseOffering,
} from "../types.js";

// ─── Rooms ───────────────────────────────────────────────────────
export const rooms: Room[] = [
  { id: 1, name: "R-101", capacity: 40, facilities: ["PROJECTOR"] },
  { id: 2, name: "R-102", capacity: 40, facilities: ["PROJECTOR"] },
  { id: 3, name: "R-201", capacity: 45, facilities: ["PROJECTOR"] },
  { id: 4, name: "LAB-A", capacity: 30, facilities: ["LAB", "PROJECTOR"] },
  { id: 5, name: "LAB-B", capacity: 30, facilities: ["LAB", "PROJECTOR"] },
  { id: 6, name: "Studio-1", capacity: 25, facilities: ["STUDIO"] },
];

// ─── Time Slots (Mon–Fri, 12 slots/day = 60 total) ──────────────
// Each slot is 50 minutes, starting at 07:30 through 17:30.
// Slot IDs:
//   Mon: 1–12   Tue: 13–24   Wed: 25–36   Thu: 37–48   Fri: 49–60
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const slotTimes = [
  { start: "07:30", end: "08:20" },
  { start: "08:20", end: "09:10" },
  { start: "09:10", end: "10:00" },
  { start: "10:00", end: "10:50" },
  { start: "10:50", end: "11:40" },
  // { start: '11:40', end: '12:30' },
  { start: "12:30", end: "13:20" },
  { start: "13:20", end: "14:10" },
  { start: "14:10", end: "15:00" },
  { start: "15:00", end: "15:50" },
  { start: "15:50", end: "16:40" },
  { start: "16:40", end: "17:30" },
];

export const timeSlots: TimeSlot[] = [];
let slotId = 1;
for (const day of days) {
  for (const time of slotTimes) {
    timeSlots.push({
      id: slotId++,
      day,
      startTime: time.start,
      endTime: time.end,
    });
  }
}

// ─── Lecturers (with preferred time slots) ───────────────────────
// Preferences are tight — most lecturers only prefer ~4 slots.
// This forces the GA to negotiate between feasibility and preference.
export const lecturers: Lecturer[] = [
  {
    id: 1,
    name: "Dr. Andi Suryadi",
    isStructural: true,
    preferredTimeSlotIds: [1, 2, 3, 4, 12, 13, 14, 15], // Mon & Tue mornings (dept head)
    competencies: ["ai-ml", "networks", "algorithms"],
  },
  {
    id: 2,
    name: "Budi Hartono, M.Kom",
    isStructural: false,
    preferredTimeSlotIds: [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22,
    ], // Mon & Tue (any slot)
    competencies: ["algorithms", "networks", "software-engineering"],
  },
  {
    id: 3,
    name: "Citra Lestari, M.T.",
    isStructural: false,
    preferredTimeSlotIds: [
      23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
      41, 42, 43, 44,
    ], // Wed & Thu only
    competencies: ["algorithms", "visual-design"],
  },
  {
    id: 4,
    name: "Dewi Anggraeni, Ph.D.",
    isStructural: false,
    preferredTimeSlotIds: [
      12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
      30, 31, 32, 33,
    ], // Tue & Wed
    competencies: ["databases", "software-engineering"],
  },
  {
    id: 5,
    name: "Eko Prasetyo, M.Sc.",
    isStructural: true,
    preferredTimeSlotIds: [1, 2, 12, 13, 23, 24, 34, 35, 45, 46], // Morning only (08:00–10:00)
    competencies: ["software-engineering", "cloud", "ai-ml"],
  },
  {
    id: 6,
    name: "Fani Rahayu, M.Kom",
    isStructural: false,
    preferredTimeSlotIds: [
      7, 8, 9, 18, 19, 20, 29, 30, 31, 40, 41, 42, 51, 52, 53,
    ], // Afternoon only (13:00–15:00)
    competencies: ["security", "software-engineering"],
  },
  {
    id: 7,
    name: "Gunawan Wibowo, M.T.",
    isStructural: false,
    preferredTimeSlotIds: [
      34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51,
      52, 53, 54, 55,
    ], // Thu & Fri only
    competencies: ["os", "algorithms", "networks"],
  },
  {
    id: 8,
    name: "Hesti Kusuma, Ph.D.",
    isStructural: false,
    preferredTimeSlotIds: [], // No preference (fully flexible)
    competencies: ["ai-ml", "algorithms", "math"],
  },
];

// ─── Courses ─────────────────────────────────────────────────────
export const courses: Course[] = [
  {
    id: 1,
    code: "IF101",
    name: "Algoritma & Pemrograman",
    sks: 3,
    requiredFacilities: ["LAB"],
    requiredCompetencies: ["algorithms"],
  },
  {
    id: 2,
    code: "IF102",
    name: "Struktur Data",
    sks: 3,
    requiredFacilities: [],
    requiredCompetencies: ["algorithms"],
  },
  {
    id: 3,
    code: "IF201",
    name: "Basis Data",
    sks: 3,
    requiredFacilities: ["LAB"],
    requiredCompetencies: ["databases"],
  },
  {
    id: 4,
    code: "IF202",
    name: "Jaringan Komputer",
    sks: 3,
    requiredFacilities: [],
    requiredCompetencies: ["networks"],
  },
  {
    id: 5,
    code: "IF301",
    name: "Rekayasa Perangkat Lunak",
    sks: 3,
    requiredFacilities: [],
    requiredCompetencies: ["software-engineering"],
  },
  {
    id: 6,
    code: "IF302",
    name: "Kecerdasan Buatan",
    sks: 3,
    requiredFacilities: [],
    requiredCompetencies: ["ai-ml"],
  },
  {
    id: 7,
    code: "DK101",
    name: "Desain Visual",
    sks: 2,
    requiredFacilities: ["STUDIO"],
    requiredCompetencies: ["visual-design"],
  },
  {
    id: 8,
    code: "IF401",
    name: "Tugas Akhir Seminar",
    sks: 2,
    requiredFacilities: [],
    requiredCompetencies: [],
  },
  {
    id: 9,
    code: "IF203",
    name: "Sistem Operasi",
    sks: 3,
    requiredFacilities: ["LAB"],
    requiredCompetencies: ["os"],
  },
  {
    id: 10,
    code: "IF303",
    name: "Keamanan Informasi",
    sks: 3,
    requiredFacilities: [],
    requiredCompetencies: ["security"],
  },
  {
    id: 11,
    code: "IF304",
    name: "Komputasi Awan",
    sks: 3,
    requiredFacilities: [],
    requiredCompetencies: ["cloud"],
  },
];

// ═══════════════════════════════════════════════════════════════════
// FEASIBLE COURSE OFFERINGS (16 offerings)
// ═══════════════════════════════════════════════════════════════════
export const courseOfferings: CourseOffering[] = [
  // ── LAB courses (compete for LAB-A and LAB-B) ──────────────────
  // Offering 1: Algoritma — LAB-A, Budi (prefers Mon/Tue)
  {
    id: 1,
    courseId: 1,
    course: courses[0]!,
    roomId: 4,
    room: rooms[3]!,
    lecturers: [lecturers[1]!],
    effectiveStudentCount: 28,
    isFixed: false,
  },
  // Offering 2: Basis Data — LAB-A, Dewi (prefers Tue/Wed)
  {
    id: 2,
    courseId: 3,
    course: courses[2]!,
    roomId: 4,
    room: rooms[3]!,
    lecturers: [lecturers[3]!],
    effectiveStudentCount: 25,
    isFixed: false,
  },
  // Offering 3: Sistem Operasi — LAB-B, Gunawan (prefers Thu/Fri)
  {
    id: 3,
    courseId: 9,
    course: courses[8]!,
    roomId: 5,
    room: rooms[4]!,
    lecturers: [lecturers[6]!],
    effectiveStudentCount: 28,
    isFixed: false,
  },

  // ── Regular classrooms ─────────────────────────────────────────
  // Offering 4: Struktur Data — R-101, Citra (prefers Wed/Thu)
  {
    id: 4,
    courseId: 2,
    course: courses[1]!,
    roomId: 1,
    room: rooms[0]!,
    lecturers: [lecturers[2]!],
    effectiveStudentCount: 38,
    isFixed: false,
  },
  // Offering 5: Jaringan Komputer — R-102, Team teaching: Andi + Budi
  {
    id: 5,
    courseId: 4,
    course: courses[3]!,
    roomId: 2,
    room: rooms[1]!,
    lecturers: [lecturers[0]!, lecturers[1]!],
    effectiveStudentCount: 35,
    isFixed: false,
  },
  // Offering 6: RPL (sks=3) — R-201, FIXED (pinned Mon 07:30-10:00), Eko (structural)
  //   → Tests: isFixedRoom=true, Static Exclusion locks R-201 slots 1-3
  //   → Task 24: fixedTimeSlotIds provides exactly `sks` contiguous slots
  {
    id: 6,
    courseId: 5,
    course: courses[4]!,
    roomId: 3,
    room: rooms[2]!,
    lecturers: [lecturers[4]!],
    effectiveStudentCount: 40,
    isFixed: true,
    fixedTimeSlotIds: [1, 2, 3], // Monday 07:30-10:00 (3 contiguous slots = sks)
  },
  // Offering 7: Kecerdasan Buatan — R-101, Andi (structural, prefers Mon/Tue AM)
  {
    id: 7,
    courseId: 6,
    course: courses[5]!,
    roomId: 1,
    room: rooms[0]!,
    lecturers: [lecturers[0]!],
    effectiveStudentCount: 30,
    isFixed: false,
  },
  // Offering 8: Keamanan Informasi — R-102, Fani (prefers afternoon)
  {
    id: 8,
    courseId: 10,
    course: courses[9]!,
    roomId: 2,
    room: rooms[1]!,
    lecturers: [lecturers[5]!],
    effectiveStudentCount: 35,
    isFixed: false,
  },

  // ── Studio offering ────────────────────────────────────────────
  // Offering 9: Desain Visual — Studio-1, Citra (prefers Wed/Thu)
  {
    id: 9,
    courseId: 7,
    course: courses[6]!,
    roomId: 6,
    room: rooms[5]!,
    lecturers: [lecturers[2]!],
    effectiveStudentCount: 22,
    isFixed: false,
  },

  // ── R-201 flexible (competes with fixed #6 and #15) ────────────
  // Offering 10: TA Seminar — R-201, Dewi, 44 students / 45 cap = 1 session
  {
    id: 10,
    courseId: 8,
    course: courses[7]!,
    roomId: 3,
    room: rooms[2]!,
    lecturers: [lecturers[3]!],
    effectiveStudentCount: 44,
    isFixed: false,
  },

  // ── More contention on R-101 (3 offerings: 4, 7, 11) ──────────
  // Offering 11: Struktur Data (section B) — R-101, Hesti (no preference)
  {
    id: 11,
    courseId: 2,
    course: courses[1]!,
    roomId: 1,
    room: rooms[0]!,
    lecturers: [lecturers[7]!],
    effectiveStudentCount: 36,
    isFixed: false,
  },

  // ── More contention on R-201 (3 offerings: 6-fixed, 10, 12) ───
  // Offering 12: RPL (section B) — R-201, Fani (prefers afternoon)
  {
    id: 12,
    courseId: 5,
    course: courses[4]!,
    roomId: 3,
    room: rooms[2]!,
    lecturers: [lecturers[5]!],
    effectiveStudentCount: 42,
    isFixed: false,
  },

  // ── Team teaching + structural lecturer overload ───────────────
  // Offering 13: AI Lab — LAB-B, Eko (structural) + Hesti
  //   → Eko now has 3 offerings (6, 13, 15) — exceeds structural max of 2
  {
    id: 13,
    courseId: 6,
    course: courses[5]!,
    roomId: 5,
    room: rooms[4]!,
    lecturers: [lecturers[4]!, lecturers[7]!],
    effectiveStudentCount: 28,
    isFixed: false,
  },

  // ── Another LAB contention ─────────────────────────────────────
  // Offering 14: Algoritma (section B) — LAB-A, Gunawan (prefers Thu/Fri)
  {
    id: 14,
    courseId: 1,
    course: courses[0]!,
    roomId: 4,
    room: rooms[3]!,
    lecturers: [lecturers[6]!],
    effectiveStudentCount: 27,
    isFixed: false,
  },

  // ── Second fixed offering (tests multiple fixed in SSA Phase 0)─
  // Offering 15: Komputasi Awan (sks=3) — R-201, FIXED (pinned Tue 07:30-10:00), Eko
  //   → Tests: second fixed offering locks R-201 slots 12-14
  //   → Together with offering 6, R-201 loses slots 1-3 (Mon AM) and 12-14 (Tue AM)
  //   → Eko now teaches offerings 6, 13, 15 = 3 sessions (structural penalty!)
  //   → Task 24: fixedTimeSlotIds provides exactly `sks` contiguous slots
  {
    id: 15,
    courseId: 11,
    course: courses[10]!,
    roomId: 3,
    room: rooms[2]!,
    lecturers: [lecturers[4]!],
    effectiveStudentCount: 30,
    isFixed: true,
    fixedTimeSlotIds: [12, 13, 14], // Tuesday 07:30-10:00 (3 contiguous slots = sks)
  },
];

// ═══════════════════════════════════════════════════════════════════
// INFEASIBLE OFFERINGS (for Pre-GA rejection testing)
// ═══════════════════════════════════════════════════════════════════

/** Facility mismatch: LAB course in a regular room (R-101 has no LAB) */
export const infeasibleFacility: CourseOffering = {
  id: 91,
  courseId: 1,
  course: courses[0]!,
  roomId: 1,
  room: rooms[0]!,
  lecturers: [lecturers[1]!],
  effectiveStudentCount: 35,
  isFixed: false,
};

/** Room capacity: 0-capacity room */
export const infeasibleCapacity: CourseOffering = {
  id: 92,
  courseId: 2,
  course: courses[1]!,
  roomId: 1,
  room: { id: 99, name: "BAD-ROOM", capacity: 0, facilities: ["PROJECTOR"] },
  lecturers: [lecturers[2]!],
  effectiveStudentCount: 30,
  isFixed: false,
};

/** No lecturers assigned */
export const infeasibleNoLecturer: CourseOffering = {
  id: 93,
  courseId: 3,
  course: courses[2]!,
  roomId: 4,
  room: rooms[3]!,
  lecturers: [],
  effectiveStudentCount: 20,
  isFixed: false,
};

/** Fixed but no fixedTimeSlotIds */
export const infeasibleFixedNoSlots: CourseOffering = {
  id: 94,
  courseId: 4,
  course: courses[3]!,
  roomId: 2,
  room: rooms[1]!,
  lecturers: [lecturers[0]!],
  effectiveStudentCount: 30,
  isFixed: true,
  fixedTimeSlotIds: [], // empty!
};

/** All infeasible offerings bundled for Layer 1 testing */
export const infeasibleOfferings: CourseOffering[] = [
  infeasibleFacility,
  infeasibleCapacity,
  infeasibleNoLecturer,
  infeasibleFixedNoSlots,
];

// Backward-compatible alias (used by existing CLI runners)
export const infeasibleOffering = infeasibleFacility;

/**
 * Exercises the nullable `roomId` path introduced in Phase 7:
 * no seed room is chosen, so the GA picks an initial room from possibleRoomIds.
 * Kept as a separate export to avoid disturbing fixture counts in existing tests.
 */
export const nullRoomOffering: CourseOffering = {
  id: 16,
  courseId: 1,
  course: courses[0]!,
  roomId: null,
  room: null,
  lecturers: [lecturers[1]!],
  effectiveStudentCount: 28,
  isFixed: false,
};
