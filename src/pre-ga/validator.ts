/**
 * Pre-GA Validator — Layer 1 Orchestrator
 * 
 * Runs all 6 checks per offering, partitions into feasible/infeasible,
 * then builds PreGACandidate[] for feasible offerings.
 */

import type { CourseOffering, PreGACandidate, PreGAValidationResult, Room, TimeSlot } from '../types.js';
import { checkIntegrity, checkRoomCapacity, checkTemporal, checkFacility, checkLecturer, checkCompetencies, checkPolicy } from './checks.js';
import { tagEntities } from './entityTagger.js';

/**
 * Phase 11 / OQ-15 — hard cap on parallel sessions for null-room overflow
 * offerings. The effective per-offering cap is `Math.min(MAX_PARALLEL_SESSIONS_HARD_CAP,
 * possibleRoomIds.length)` (data-driven resolution of OQ-15). Pre-assigned-room
 * offerings split across timeslots (not rooms) and are not subject to this cap
 * per OQ-16.
 */
export const MAX_PARALLEL_SESSIONS_HARD_CAP = 5;

/**
 * Run the complete Pre-GA validation pipeline.
 * Pure function — takes data in, returns results, no side effects.
 *
 * When `allRooms` is provided, populates `possibleRoomIds[]` on every
 * Flexible PreGACandidate (techspec §6.3 / [ARCH-OBS-04]). A room qualifies
 * iff it has adequate capacity and contains every requiredFacility. Flexible
 * offerings with zero qualifying rooms are rejected as infeasible.
 */
export function runPreGA(
  offerings: CourseOffering[],
  allTimeSlots: TimeSlot[],
  allRooms?: Room[],
  // Phase 10 #6c: when caller passes a lockedRoomMap (built from the
  // LockedRoom DB table by the worker / orchestrator), it replaces the
  // legacy in-process proxy below. CLI callers and tests omit this arg and
  // get the legacy behavior (filter `isFixed === true && roomId !== null`
  // on CourseOffering rows).
  lockedRoomMap?: ReadonlyMap<number, number>,
): { validation: PreGAValidationResult; candidates: PreGACandidate[] } {

  const feasible: CourseOffering[] = [];
  const infeasible: PreGAValidationResult['infeasible'] = [];

  const totalSlots = allTimeSlots.length;
  const checks = [
    (o: CourseOffering) => checkIntegrity(o),
    (o: CourseOffering) => checkRoomCapacity(o),
    (o: CourseOffering) => checkTemporal(o, totalSlots),
    (o: CourseOffering) => checkFacility(o),
    (o: CourseOffering) => checkLecturer(o),
    (o: CourseOffering) => checkCompetencies(o),
    (o: CourseOffering) => checkPolicy(o),
  ];

  for (const offering of offerings) {
    let passed = true;
    for (const check of checks) {
      const result = check(offering);
      if (!result.passed) {
        infeasible.push({ offering, failedCheck: result });
        passed = false;
        break; // Stop on first failure (sequential gate)
      }
    }
    if (passed) {
      feasible.push(offering);
    }
  }

  // Compute possibleRoomIds[] for Flexible offerings ([ARCH-OBS-04]).
  // The filter branches on `offering.roomId`:
  //   - roomId === null (null-room offering): facility-only filter. Phase 11
  //     task #1 — the overflow path (task #2) may split the offering across
  //     multiple rooms whose combined capacity holds the cohort, so per-room
  //     capacity is no longer a qualifying gate. Rejection code is
  //     NO_FACILITY_MATCH (course needs facilities no room provides).
  //   - roomId !== null (pre-assigned-room offering): strict filter
  //     (capacity >= effectiveStudentCount AND all facilities). possibleRoomIds
  //     here represents alternates equivalent to the chosen room — its split
  //     is computed against the chosen room's capacity (task #2), so every
  //     alternate must hold the offering on its own. Rejection code remains
  //     NO_ROOMS_QUALIFY.
  const possibleRoomIdsByOffering = new Map<number, number[]>();
  // Phase 11 task #2: parallelSessionCount for null-room overflow offerings is
  // computed here (alongside possibleRoomIds) because it depends on the
  // post-filter qualifying-room set. Pre-assigned-room offerings keep the
  // legacy `⌈students/room.capacity⌉` formula below at candidate-build time.
  const nullRoomParallelByOffering = new Map<number, number>();
  const roomById = new Map<number, Room>((allRooms ?? []).map(r => [r.id, r]));
  if (allRooms) {
    const stillFeasible: CourseOffering[] = [];
    for (const offering of feasible) {
      // Skip possibleRoomIds computation only when the offering has a definite
      // locked room (legacy `isFixed && roomId !== null` path). Phase 10
      // decouples "fixed time" from "locked room": an offering with
      // `isFixed: true, roomId: null` is "fixed time, flexible room" — the
      // chromosome seeder needs possibleRoomIds to pick a room from the pool.
      if (offering.isFixed && offering.roomId !== null) {
        stillFeasible.push(offering);
        continue;
      }
      const required = offering.course.requiredFacilities;
      const isNullRoom = offering.roomId === null;
      const qualifying = allRooms
        .filter(r =>
          (isNullRoom || r.capacity >= offering.effectiveStudentCount) &&
          required.every(f => r.facilities.includes(f))
        )
        .map(r => r.id);
      if (qualifying.length === 0) {
        infeasible.push({
          offering,
          failedCheck: isNullRoom
            ? {
                passed: false,
                code: 'NO_FACILITY_MATCH',
                message:
                  `Offering ${offering.id} (${offering.course.name}) has no ` +
                  `pre-assigned room and no available room provides the ` +
                  `required facilities [${required.join(', ')}].`,
              }
            : {
                passed: false,
                code: 'NO_ROOMS_QUALIFY',
                message:
                  `Offering ${offering.id} (${offering.course.name}) is Flexible but ` +
                  `no room satisfies capacity >= ${offering.effectiveStudentCount} ` +
                  `with facilities [${required.join(', ')}].`,
              },
        });
        continue;
      }

      // Phase 11 task #2 — null-room parallelSessionCount and overflow cap.
      // For null-room offerings, split is across ROOMS (not timeslots per OQ-16),
      // so the required session count is driven by the largest qualifying room.
      // OQ-15 resolved to a data-driven cap: min(hard cap 5, |possibleRoomIds|).
      // Exceeding the cap → NO_CAPACITY_COMBINATION (the loose facility-only
      // pool doesn't have enough room headroom to absorb the cohort).
      if (isNullRoom) {
        const maxQualifyingCapacity = Math.max(
          ...qualifying.map(id => roomById.get(id)!.capacity),
        );
        const requiredSessions = offering.effectiveStudentCount > maxQualifyingCapacity
          ? Math.ceil(offering.effectiveStudentCount / maxQualifyingCapacity)
          : 1;
        const cap = Math.min(MAX_PARALLEL_SESSIONS_HARD_CAP, qualifying.length);
        if (requiredSessions > cap) {
          infeasible.push({
            offering,
            failedCheck: {
              passed: false,
              code: 'NO_CAPACITY_COMBINATION',
              message:
                `Offering ${offering.id} (${offering.course.name}) needs ` +
                `${requiredSessions} parallel sessions to seat ` +
                `${offering.effectiveStudentCount} students ` +
                `(largest qualifying room holds ${maxQualifyingCapacity}), ` +
                `but the cap is ${cap} ` +
                `(min of MAX_PARALLEL_SESSIONS=${MAX_PARALLEL_SESSIONS_HARD_CAP} ` +
                `and |possibleRoomIds|=${qualifying.length}).`,
            },
          });
          continue;
        }
        nullRoomParallelByOffering.set(offering.id, requiredSessions);
      }

      possibleRoomIdsByOffering.set(offering.id, qualifying);
      stillFeasible.push(offering);
    }
    feasible.length = 0;
    feasible.push(...stillFeasible);
  }

  // ─── Phase 15 #1 — Cohort aggregation pass (OQ-22 / OQ-23) ─────────
  // Group `feasible` offerings by cohort key. The backlog default key is
  // `${semesterId}:${courseId}`, but `CourseOffering` in-memory does not
  // carry `semesterId` (see `src/types.ts:CourseOffering`); upstream
  // (`scheduleRepo.loadScheduleInputs`) already filters by semester at the
  // Prisma boundary, so every `runPreGA` call operates on a single
  // semester's worth of offerings. The cohort key therefore reduces to
  // `courseId` alone — semantically equivalent to the backlog default
  // because the semester filter is implicit.
  //
  // note (Phase 15 #1 / OQ-22): cohort key = courseId (semester is implicit).
  //
  // For each cohort, the "primary" sibling is the one with the lowest id
  // (deterministic and stable across runs; chosen over `parentOfferingId`
  // because OQ-27 keeps that field as pure metadata). The primary's id
  // becomes the emitted candidate's `offeringId`, which is what every
  // downstream consumer (entityTagger lockedRoomMap lookup, SSA, GA,
  // persistence) keys on. Single-offering cohorts collapse trivially —
  // primary === sibling[0] — and the candidate is structurally identical
  // to the pre-Phase-15 shape, plus the new `siblingOfferingIds: [id]`.
  const cohortsByCourseId = new Map<number, CourseOffering[]>();
  for (const offering of feasible) {
    const arr = cohortsByCourseId.get(offering.courseId) ?? [];
    arr.push(offering);
    cohortsByCourseId.set(offering.courseId, arr);
  }
  for (const [, siblings] of cohortsByCourseId) {
    siblings.sort((a, b) => a.id - b.id);
  }

  // Build PreGACandidate[] — one per cohort, not one per offering.
  const rawCandidates: PreGACandidate[] = [];
  for (const [, siblings] of cohortsByCourseId) {
    const primary = siblings[0]!; // lowest-id sibling, post-sort
    const siblingOfferingIds = siblings.map(s => s.id); // already ascending

    // OQ-23 default: cohort.effectiveStudentCount = max(siblings).
    // Single-offering cohorts: max-of-one === the one value (back-compat).
    const cohortStudentCount = Math.max(
      ...siblings.map(s => s.effectiveStudentCount),
    );

    // Phase 11 task #2 + Phase 15 #1: parallelSessionCount derivation has
    // two regimes, now driven by the cohort's unified `cohortStudentCount`
    // rather than any single sibling's count:
    //   - Pre-assigned room (primary.room !== null): legacy formula
    //     `⌈cohortStudentCount / room.capacity⌉` — split across timeslots
    //     within the chosen room (OQ-16). Single-sibling cohorts match
    //     today's output exactly (max-of-one === sibling's own count).
    //   - Null room (primary.room === null): split is across ROOMS. We
    //     recompute against `cohortStudentCount` and the largest qualifying
    //     room's capacity (all siblings share the same course → same
    //     requiredFacilities → same qualifying-rooms set, so deriving from
    //     the primary's pool is safe). For single-sibling cohorts the
    //     result matches the precomputed `nullRoomParallelByOffering` entry;
    //     we use that value directly to avoid recomputation in the common
    //     case and stay byte-identical to today. For multi-sibling cohorts
    //     we recompute from the cohort's `max(siblings)` count.
    //
    //     Falls back to 1 when `allRooms` was omitted (CLI / unit-test
    //     path that skips room filtering altogether).
    let parallelSessionCount: number;
    if (primary.room) {
      parallelSessionCount = Math.ceil(
        cohortStudentCount / primary.room.capacity,
      );
    } else if (siblings.length === 1) {
      parallelSessionCount = nullRoomParallelByOffering.get(primary.id) ?? 1;
    } else {
      const qualifying = possibleRoomIdsByOffering.get(primary.id);
      const maxQualifyingCapacity = qualifying && qualifying.length > 0
        ? Math.max(...qualifying.map(id => roomById.get(id)!.capacity))
        : 0;
      parallelSessionCount = maxQualifyingCapacity > 0 && cohortStudentCount > maxQualifyingCapacity
        ? Math.ceil(cohortStudentCount / maxQualifyingCapacity)
        : 1;
    }

    // For fixed offerings, possibleTimeSlotIds = fixedTimeSlotIds only.
    // For non-fixed, possibleTimeSlotIds = ALL available time slots.
    // TODO Phase 15 #3: sibling offerings may disagree on `isFixed` and
    // `fixedTimeSlotIds`; for now we take the primary's values. Conflict
    // detection across siblings is task #3's concern.
    const possibleTimeSlotIds = primary.isFixed && primary.fixedTimeSlotIds
      ? [...primary.fixedTimeSlotIds]
      : allTimeSlots.map(ts => ts.id);

    // TODO Phase 15 #3: when siblings disagree on `roomId` (one has a
    // pre-assigned room, another is null-room), the cohort silently
    // adopts the primary's roomId. Mixed-lock siblings need explicit
    // conflict detection. Same caveat applies to `lecturerIds` — task #2
    // introduces `lecturerPool` (union of siblings); for task #1 we keep
    // the primary's lecturerIds for backward compatibility.
    const candidate: PreGACandidate = {
      offeringId: primary.id,
      courseId: primary.courseId,
      roomId: primary.roomId ?? null,
      lecturerIds: primary.lecturers.map(l => l.id),
      effectiveStudentCount: cohortStudentCount,
      parallelSessionCount,
      sessionDuration: primary.course.sks,
      possibleTimeSlotIds,
      isFixedRoom: false, // will be stamped by tagEntities below
      siblingOfferingIds,
    };
    const possibleRoomIds = possibleRoomIdsByOffering.get(primary.id);
    if (possibleRoomIds) candidate.possibleRoomIds = possibleRoomIds;
    rawCandidates.push(candidate);
  }

  // Resolve the lockedRoomMap. Phase 10 #6c: when the caller (worker /
  // orchestrator) supplied one, use it verbatim — it was built from the
  // LockedRoom DB table, which is the single source of truth post-Phase-10.
  // When omitted (CLI / unit tests), fall back to the legacy in-process
  // proxy that filters `feasible` for `isFixed === true && roomId !== null`.
  // Either way, the resulting map only ever contains non-null roomIds — task
  // #1 made that contract explicit.
  const effectiveLockedRoomMap: ReadonlyMap<number, number> = lockedRoomMap ??
    new Map<number, number>(
      feasible
        .filter((o): o is CourseOffering & { roomId: number } => o.isFixed && o.roomId !== null)
        .map(o => [o.id, o.roomId])
    );

  const candidates = tagEntities(rawCandidates, effectiveLockedRoomMap);

  return {
    validation: { feasible, infeasible },
    candidates,
  };
}
