/**
 * Pre-GA Validation Checks
 * 
 * Six sequential checks per offering:
 * 1. integrity     — required fields present
 * 2. roomCapacity  — students fit in assigned room
 * 3. temporal      — enough time slots exist
 * 4. facility      — room has required facilities
 * 5. lecturer      — at least one lecturer assigned
 * 6. policy        — UPJ-specific academic rules
 */

import type { CourseOffering, CheckResult } from '../types.js';

// ─── Check 1: Data Integrity ────────────────────────────────────
export function checkIntegrity(offering: CourseOffering): CheckResult {
  if (!offering.course) {
    return { passed: false, code: 'INTEGRITY_NO_COURSE', message: `Offering ${offering.id}: missing course relation.` };
  }
  if (!offering.room) {
    return { passed: false, code: 'INTEGRITY_NO_ROOM', message: `Offering ${offering.id}: missing room relation.` };
  }
  if (!offering.lecturers || offering.lecturers.length === 0) {
    return { passed: false, code: 'INTEGRITY_NO_LECTURERS', message: `Offering ${offering.id}: no lecturers assigned.` };
  }
  if (offering.effectiveStudentCount <= 0) {
    return { passed: false, code: 'INTEGRITY_NO_STUDENTS', message: `Offering ${offering.id}: effectiveStudentCount is ${offering.effectiveStudentCount}.` };
  }
  return { passed: true, code: 'OK', message: '' };
}

// ─── Check 2: Room Capacity ─────────────────────────────────────
// Note: We do NOT reject oversized classes here — instead, requiredSessions
// is calculated as ⌈students / capacity⌉ which handles parallel split.
export function checkRoomCapacity(offering: CourseOffering): CheckResult {
  // Room must exist (already checked in integrity, but defensive)
  if (!offering.room) {
    return { passed: false, code: 'ROOM_MISSING', message: `Offering ${offering.id}: no room assigned.` };
  }
  // Room capacity must be > 0
  if (offering.room.capacity <= 0) {
    return { passed: false, code: 'ROOM_ZERO_CAPACITY', message: `Room ${offering.room.name} has zero or negative capacity.` };
  }
  return { passed: true, code: 'OK', message: '' };
}

// ─── Check 3: Temporal Sufficiency ──────────────────────────────
// Are there enough time slots in the week for this offering's sessions?
export function checkTemporal(offering: CourseOffering, totalTimeSlots: number): CheckResult {
  const requiredSessions = Math.ceil(offering.effectiveStudentCount / offering.room.capacity);
  if (totalTimeSlots < requiredSessions) {
    return {
      passed: false, code: 'TEMPORAL_INSUFFICIENT',
      message: `Offering ${offering.id} needs ${requiredSessions} sessions but only ${totalTimeSlots} time slots exist.`,
    };
  }
  return { passed: true, code: 'OK', message: '' };
}

// ─── Check 4: Facility Compatibility ────────────────────────────
export function checkFacility(offering: CourseOffering): CheckResult {
  const required = offering.course.requiredFacilities;
  const available = offering.room.facilities;
  for (const facility of required) {
    if (!available.includes(facility)) {
      return {
        passed: false, code: 'FACILITY_MISMATCH',
        message: `Offering ${offering.id} (${offering.course.name}) requires [${facility}] but room ${offering.room.name} only has [${available.join(', ')}].`,
      };
    }
  }
  return { passed: true, code: 'OK', message: '' };
}

// ─── Check 5: Lecturer Availability ─────────────────────────────
export function checkLecturer(offering: CourseOffering): CheckResult {
  if (offering.lecturers.length === 0) {
    return {
      passed: false, code: 'LECTURER_NONE',
      message: `Offering ${offering.id}: no lecturers assigned.`,
    };
  }
  // Check that all lecturers have valid IDs
  for (const lecturer of offering.lecturers) {
    if (!lecturer.id || !lecturer.name) {
      return {
        passed: false, code: 'LECTURER_INVALID',
        message: `Offering ${offering.id}: lecturer data incomplete (id=${lecturer.id}).`,
      };
    }
  }
  return { passed: true, code: 'OK', message: '' };
}

// ─── Check 6: Academic Policy ───────────────────────────────────
export function checkPolicy(offering: CourseOffering): CheckResult {
  // Fixed offerings must have fixedTimeSlotIds specified
  if (offering.isFixed && (!offering.fixedTimeSlotIds || offering.fixedTimeSlotIds.length === 0)) {
    return {
      passed: false, code: 'POLICY_FIXED_NO_SLOTS',
      message: `Offering ${offering.id} is marked fixed but has no fixedTimeSlotIds.`,
    };
  }
  return { passed: true, code: 'OK', message: '' };
}
