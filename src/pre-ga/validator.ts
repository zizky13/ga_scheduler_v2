/**
 * Pre-GA Validator — Layer 1 Orchestrator
 * 
 * Runs all 6 checks per offering, partitions into feasible/infeasible,
 * then builds PreGACandidate[] for feasible offerings.
 */

import type { CourseOffering, PreGACandidate, PreGAValidationResult, TimeSlot } from '../types.js';
import { checkIntegrity, checkRoomCapacity, checkTemporal, checkFacility, checkLecturer, checkCompetencies, checkPolicy } from './checks.js';
import { tagEntities } from './entityTagger.js';

/**
 * Run the complete Pre-GA validation pipeline.
 * Pure function — takes data in, returns results, no side effects.
 */
export function runPreGA(
  offerings: CourseOffering[],
  allTimeSlots: TimeSlot[]
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

    return {
      offeringId: offering.id,
      courseId: offering.courseId,
      roomId: offering.roomId,
      lecturerIds: offering.lecturers.map(l => l.id),
      requiredSessions,
      possibleTimeSlotIds,
      isFixedRoom: false, // will be stamped by tagEntities below
    };
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
