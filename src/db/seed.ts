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

// ═══════════════════════════════════════════════════════════════════
// STRUCTURALLY-INFEASIBLE OFFERINGS (Phase E3 task 19 — scenario C)
// ═══════════════════════════════════════════════════════════════════

/**
 * Additive offerings that compose the `structurally-infeasible` ablation
 * scenario. The original backlog premise (using `infeasibleOfferings` to
 * make SSA report INFEASIBLE) was empirically wrong: Pre-GA filters all
 * four `infeasibleOfferings` as Layer-1 violations before SSA runs, so
 * SSA only ever sees the 15 surviving canonical offerings and returns
 * FEASIBLE. Task 19's revised approach builds a real over-subscription:
 * each offering below individually passes every Pre-GA check, but their
 * aggregate demand exceeds the bipartite matching capacity that SSA's
 * Hopcroft–Karp searches over (the right-hand side of the bipartite
 * graph consists of distinct block-start slot IDs, not (room, slot)
 * coordinates — see `src/ssa/bipartiteGraph.ts:1-21`), so
 * `maximumAchievableMatching < totalSessionsRequired` and SSA returns
 * `INFEASIBLE` with code `BIPARTITE_MATCHING_INSUFFICIENT`.
 *
 * Construction:
 *   - 50 extra sections of `IF101 Algoritma & Pemrograman` (course id 1,
 *     sks=3, requires LAB facility and `algorithms` competency).
 *   - Each pinned to LAB-A (room id 4, capacity 30, facilities=[LAB,PROJECTOR]).
 *   - Each taught by lecturer Hesti Kusuma (id 8) — she has the
 *     `algorithms` competency and no preference constraint.
 *   - `isFixed: false`, no `fixedTimeSlotIds`.
 *   - `effectiveStudentCount: 28` (≤ LAB-A's capacity of 30).
 *
 * Why this exceeds Hopcroft-Karp's capacity:
 *   The bipartite right side is keyed by slot IDs, not (room, slot)
 *   pairs. With 11 slots per day × 5 days = 55 total slot IDs and a
 *   3-SKS course needing 3 contiguous same-day slots, only 9 valid
 *   block-starts exist per day → 45 right-hand-side nodes available
 *   for sks=3 candidates. The canonical `courseOfferings` already
 *   produces 15 sessions, so adding 50 LAB sessions pushes total
 *   demand to 65 vs at most ~37 simultaneously matchable — guaranteed
 *   infeasibility.
 *
 * Empirical SSA verdict on `[...courseOfferings, ...structurallyInfeasibleOfferings]`:
 *   `status === 'INFEASIBLE'` (BIPARTITE_MATCHING_INSUFFICIENT),
 *   `totalSessionsRequired = 65`, `maximumAchievableMatching` strictly
 *   less than 65.
 *
 * Scope:
 *   Additive only — the canonical `courseOfferings`, `infeasibleOfferings`,
 *   and every other existing export are untouched. Consumed only by
 *   `src/experiments/scenarios.ts` (the ablation harness).
 */
export const structurallyInfeasibleOfferings: CourseOffering[] = Array.from(
  { length: 50 },
  (_, i): CourseOffering => ({
    id: 200 + i,
    courseId: 1,
    course: courses[0]!,
    roomId: 4,
    room: rooms[3]!,
    lecturers: [lecturers[7]!],
    effectiveStudentCount: 28,
    isFixed: false,
  }),
);

// ═══════════════════════════════════════════════════════════════════
// BORDERLINE OFFERINGS (Phase E3 task 20 — scenario D)
// ═══════════════════════════════════════════════════════════════════

/**
 * Additive offerings that compose the `borderline-ac3-prunes` ablation
 * scenario (Phase E3 task 20). The goal is to construct an input where
 * Phase 0 (Static Exclusion) + AC-3 prune a non-trivial number of
 * candidate domain coordinates, but Phase 2 (Hopcroft-Karp) still
 * confirms a maximum matching exists — i.e. SSA returns FEASIBLE while
 * the GA receives a meaningfully smaller / better-shaped initial search
 * space than it would without SSA.
 *
 * Construction (additive — composed with `courseOfferings` by the
 * scenario builder; the canonical export is unmodified):
 *
 *   FIXED offerings (4, each locking sks contiguous (room, slot) coords):
 *     - 300: Struktur Data    (sks=3) → R-101 (id 1) at slots [4,5,6]   — Hesti
 *     - 301: Jaringan Komputer(sks=3) → R-102 (id 2) at slots [15,16,17]— Budi
 *     - 302: Sistem Operasi   (sks=3) → LAB-A (id 4) at slots [37,38,39]— Gunawan
 *     - 303: TA Seminar       (sks=2) → R-101 (id 1) at slots [10,11]   — Hesti
 *     Locks added by these four = 3+3+3+2 = 11 coordinates, none of which
 *     collide with the seed's existing fixed offerings 6 (R-201 slots 1–3)
 *     and 15 (R-201 slots 12–14), nor with each other.
 *
 *   FLEXIBLE offerings (3, all sharing rooms that the new fixed offerings
 *   lock — so AC-3 prunes their domains meaningfully):
 *     - 304: Struktur Data    (sks=3) → R-101 (general PROJECTOR room) — Hesti
 *     - 305: Jaringan Komputer(sks=3) → R-102 (general PROJECTOR room) — Budi
 *     - 306: TA Seminar       (sks=2) → R-101 (general PROJECTOR room) — Hesti
 *     Pre-GA computes `possibleRoomIds` for each from facility/capacity
 *     matching (the three general rooms R-101/R-102/R-201 all qualify for
 *     non-LAB / non-STUDIO courses), so each flexible offering has a
 *     broad room domain that overlaps multiple locked rooms.
 *
 * Acceptance contract (task E3.20):
 *   - `runStaticExclusion(candidates).lockedCoordinates.size ≥ 4`. On the
 *     full composed input the realised size is 17 (6 from existing fixed
 *     offerings 6 & 15 + 11 from the four new fixed entries).
 *   - `runSSA(candidates, timeSlots).status === 'FEASIBLE'` — Hopcroft-Karp
 *     still finds a maximum matching covering all sessions despite the
 *     domain pruning.
 *   - The canonical `courseOfferings`, `infeasibleOfferings`, and
 *     `structurallyInfeasibleOfferings` exports remain unchanged.
 *
 * IDs (300–306) are picked outside the ranges already used by canonical
 * (1–15), infeasible (91–94), structurally-infeasible (200–249), and the
 * nullable-room exerciser (16). Lecturer + course pairings respect the
 * required competencies; capacities are well below room limits; no two
 * fixed offerings share a (room, slot) coordinate.
 */
export const borderlineOfferings: CourseOffering[] = [
  // ── Fixed offerings (lock 11 coordinates across R-101, R-102, LAB-A) ──
  {
    id: 300,
    courseId: 2,
    course: courses[1]!, // Struktur Data, sks=3, no facility required
    roomId: 1,
    room: rooms[0]!, // R-101
    lecturers: [lecturers[7]!], // Hesti (algorithms competency)
    effectiveStudentCount: 30,
    isFixed: true,
    fixedTimeSlotIds: [4, 5, 6], // Monday 10:00–13:20
  },
  {
    id: 301,
    courseId: 4,
    course: courses[3]!, // Jaringan Komputer, sks=3, no facility required
    roomId: 2,
    room: rooms[1]!, // R-102
    lecturers: [lecturers[1]!], // Budi (networks competency)
    effectiveStudentCount: 32,
    isFixed: true,
    fixedTimeSlotIds: [15, 16, 17], // Tuesday 11:40-style mid-afternoon block
  },
  {
    id: 302,
    courseId: 9,
    course: courses[8]!, // Sistem Operasi, sks=3, requires LAB
    roomId: 4,
    room: rooms[3]!, // LAB-A
    lecturers: [lecturers[6]!], // Gunawan (os competency)
    effectiveStudentCount: 26,
    isFixed: true,
    fixedTimeSlotIds: [37, 38, 39], // Thursday 07:30–10:00
  },
  {
    id: 303,
    courseId: 8,
    course: courses[7]!, // TA Seminar, sks=2, no facility / competency required
    roomId: 1,
    room: rooms[0]!, // R-101
    lecturers: [lecturers[7]!], // Hesti (no required competency)
    effectiveStudentCount: 24,
    isFixed: true,
    fixedTimeSlotIds: [10, 11], // Monday 15:00–16:40
  },

  // ── Flexible offerings (broad room domain overlapping locked rooms) ──
  {
    id: 304,
    courseId: 2,
    course: courses[1]!, // Struktur Data, sks=3
    roomId: 1,
    room: rooms[0]!, // R-101 (Pre-GA derives possibleRoomIds = [1, 2, 3])
    lecturers: [lecturers[7]!], // Hesti
    effectiveStudentCount: 34,
    isFixed: false,
  },
  {
    id: 305,
    courseId: 4,
    course: courses[3]!, // Jaringan Komputer, sks=3
    roomId: 2,
    room: rooms[1]!, // R-102 (possibleRoomIds = [1, 2, 3])
    lecturers: [lecturers[1]!], // Budi
    effectiveStudentCount: 30,
    isFixed: false,
  },
  {
    id: 306,
    courseId: 8,
    course: courses[7]!, // TA Seminar, sks=2
    roomId: 1,
    room: rooms[0]!, // R-101 (possibleRoomIds = [1, 2, 3])
    lecturers: [lecturers[7]!], // Hesti
    effectiveStudentCount: 28,
    isFixed: false,
  },
];

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
