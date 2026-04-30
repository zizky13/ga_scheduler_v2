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
  allRooms?: Room[]
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
  // A room qualifies iff capacity >= effectiveStudentCount AND all required
  // facilities are present. Flexible offerings with no qualifying rooms are
  // rejected as infeasible (NO_ROOMS_QUALIFY).
  const possibleRoomIdsByOffering = new Map<number, number[]>();
  if (allRooms) {
    const stillFeasible: CourseOffering[] = [];
    for (const offering of feasible) {
      if (offering.isFixed) {
        stillFeasible.push(offering);
        continue;
      }
      const required = offering.course.requiredFacilities;
      const qualifying = allRooms
        .filter(r =>
          r.capacity >= offering.effectiveStudentCount &&
          required.every(f => r.facilities.includes(f))
        )
        .map(r => r.id);
      if (qualifying.length === 0) {
        infeasible.push({
          offering,
          failedCheck: {
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
    const requiredSessions = Math.ceil(
      offering.effectiveStudentCount / offering.room.capacity
    );

    // For fixed offerings, possibleTimeSlotIds = fixedTimeSlotIds only
    // For non-fixed, possibleTimeSlotIds = ALL available time slots
    const possibleTimeSlotIds = offering.isFixed && offering.fixedTimeSlotIds
      ? [...offering.fixedTimeSlotIds]
      : allTimeSlots.map(ts => ts.id);

    const candidate: PreGACandidate = {
      offeringId: offering.id,
      courseId: offering.courseId,
      roomId: offering.roomId,
      lecturerIds: offering.lecturers.map(l => l.id),
      requiredSessions,
      possibleTimeSlotIds,
      isFixedRoom: false, // will be stamped by tagEntities below
    };
    const possibleRoomIds = possibleRoomIdsByOffering.get(offering.id);
    if (possibleRoomIds) candidate.possibleRoomIds = possibleRoomIds;
    return candidate;
  });

  // Build lockedRoomMap from CourseOffering.isFixed
  // (In the full stack, this comes from the LockedRoom DB table via FR-01)
  const lockedRoomMap = new Map<number, number>(
    feasible
      .filter(o => o.isFixed)
      .map(o => [o.id, o.roomId])
  );

  const candidates = tagEntities(rawCandidates, lockedRoomMap);

  return {
    validation: { feasible, infeasible },
    candidates,
  };
}
