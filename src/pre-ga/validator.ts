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
      possibleRoomIdsByOffering.set(offering.id, qualifying);
      stillFeasible.push(offering);
    }
    feasible.length = 0;
    feasible.push(...stillFeasible);
  }

  // Build PreGACandidate[] for feasible offerings
  const rawCandidates: PreGACandidate[] = feasible.map(offering => {
    // Phase 10 #6a: when `offering.room === null`, parallelSessionCount falls
    // back to 1 — the validator's possibleRoomIds filter requires each
    // qualifying room to hold the full offering alone (`r.capacity >=
    // effectiveStudentCount`), so a single session is sufficient. Split-on-
    // overflow for null-room offerings (where no single room fits) is a
    // separate concern tracked as task #6b.
    const parallelSessionCount = offering.room
      ? Math.ceil(offering.effectiveStudentCount / offering.room.capacity)
      : 1;

    // For fixed offerings, possibleTimeSlotIds = fixedTimeSlotIds only
    // For non-fixed, possibleTimeSlotIds = ALL available time slots
    const possibleTimeSlotIds = offering.isFixed && offering.fixedTimeSlotIds
      ? [...offering.fixedTimeSlotIds]
      : allTimeSlots.map(ts => ts.id);

    const candidate: PreGACandidate = {
      offeringId: offering.id,
      courseId: offering.courseId,
      roomId: offering.roomId ?? null,
      lecturerIds: offering.lecturers.map(l => l.id),
      parallelSessionCount,
      sessionDuration: offering.course.sks,
      possibleTimeSlotIds,
      isFixedRoom: false, // will be stamped by tagEntities below
    };
    const possibleRoomIds = possibleRoomIdsByOffering.get(offering.id);
    if (possibleRoomIds) candidate.possibleRoomIds = possibleRoomIds;
    return candidate;
  });

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
