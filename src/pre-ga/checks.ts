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

import type { CourseOffering, CheckResult, Lecturer, Course } from '../types.js';

// ─── Eligibility Helper ─────────────────────────────────────────
// A lecturer is eligible for a course iff:
//   - the course has no requiredCompetencies (open assignment), OR
//   - the lecturer's competencies intersect requiredCompetencies (≥ 1 match).
export function isLecturerEligibleForCourse(lecturer: Lecturer, course: Course): boolean {
  if (course.requiredCompetencies.length === 0) return true;
  const owned = new Set(lecturer.competencies);
  for (const req of course.requiredCompetencies) {
    if (owned.has(req)) return true;
  }
  return false;
}

// ─── Check 1: Data Integrity ────────────────────────────────────
// Phase 10 #6a: `offering.room === null` is now a valid state (Phase 7 made
// `roomId` nullable). It means "no room chosen yet — the GA will pick from
// possibleRoomIds." Reject only when the course or lecturer relations are
// missing or the student count is non-positive.
export function checkIntegrity(offering: CourseOffering): CheckResult {
  // Phase 14 #6: mapping defects detected at the row→domain boundary
  // (`src/repo/mappers/courseOfferingMapper.ts`) surface here as the first
  // branch. The mapper records orphan lecturer / room references in
  // `offering.mappingDefects` instead of throwing, so a single bad offering
  // turns into a single Pre-GA rejection rather than killing the worker
  // for the entire run. Metadata shape mirrors Phase 14 #4's
  // `CROSS_SEMESTER_REFERENCE` envelope (see
  // `src/api/routes/course-offerings.ts:crossSemesterError`).
  const defects = offering.mappingDefects;
  if (defects && (
    (defects.missingLecturerIds && defects.missingLecturerIds.length > 0) ||
    (defects.missingRoomId !== undefined && defects.missingRoomId !== null)
  )) {
    type Mismatch = { id: number; actualSemesterId?: number };
    type FieldGroup = {
      field: 'lecturerIds' | 'roomId';
      expectedSemesterId?: number;
      mismatches: Mismatch[];
    };
    const groups: FieldGroup[] = [];
    if (defects.missingLecturerIds && defects.missingLecturerIds.length > 0) {
      groups.push({
        field: 'lecturerIds',
        mismatches: defects.missingLecturerIds.map((id) => ({ id })),
      });
    }
    if (defects.missingRoomId !== undefined && defects.missingRoomId !== null) {
      groups.push({
        field: 'roomId',
        mismatches: [{ id: defects.missingRoomId }],
      });
    }
    const primary = groups[0]!;
    const firstId = primary.mismatches[0]!.id;
    const message =
      `Offering ${offering.id}: ${primary.field} reference ${firstId} ` +
      `does not exist in the current run's data scope ` +
      `(likely a cross-semester / orphan reference).`;
    return {
      passed: false,
      code: 'CROSS_SEMESTER_DEFECT',
      message,
      metadata: {
        field: primary.field,
        expectedSemesterId: primary.expectedSemesterId,
        mismatches: primary.mismatches,
        fields: groups,
      },
    };
  }

  if (!offering.course) {
    return { passed: false, code: 'INTEGRITY_NO_COURSE', message: `Offering ${offering.id}: missing course relation.` };
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
// Phase 10 #6a: when `offering.room === null`, capacity is enforced by the
// validator's `possibleRoomIds` filter (`r.capacity >= effectiveStudentCount`)
// — skip the per-room check here so null-room offerings can proceed.
export function checkRoomCapacity(offering: CourseOffering): CheckResult {
  if (!offering.room) return { passed: true, code: 'OK', message: '' };
  // Room capacity must be > 0
  if (offering.room.capacity <= 0) {
    return { passed: false, code: 'ROOM_ZERO_CAPACITY', message: `Room ${offering.room.name} has zero or negative capacity.` };
  }
  return { passed: true, code: 'OK', message: '' };
}

// ─── Check 3: Temporal Sufficiency ──────────────────────────────
// Are there enough time slots in the week for this offering's sessions?
// Phase 10 #6a: when `offering.room === null` we can't compute requiredSessions
// against a specific room. Defer to the validator's `possibleRoomIds` filter
// + the SSA's Hopcroft-Karp matching, both of which catch real temporal
// infeasibility downstream. Trivially pass here as long as the timetable has
// at least one slot.
export function checkTemporal(offering: CourseOffering, totalTimeSlots: number): CheckResult {
  if (!offering.room) {
    if (totalTimeSlots <= 0) {
      return { passed: false, code: 'TEMPORAL_INSUFFICIENT', message: `Offering ${offering.id}: no time slots configured.` };
    }
    return { passed: true, code: 'OK', message: '' };
  }
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
// Phase 10 #6a: when `offering.room === null`, facility-matching is enforced by
// the validator's `possibleRoomIds` filter — skip here.
export function checkFacility(offering: CourseOffering): CheckResult {
  if (!offering.room) return { passed: true, code: 'OK', message: '' };
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

// ─── Check 6: Lecturer Competency ───────────────────────────────
// Every assigned lecturer must own ≥ 1 competency required by the course.
// If the course has no requiredCompetencies, this check is a no-op.
export function checkCompetencies(offering: CourseOffering): CheckResult {
  const required = offering.course.requiredCompetencies;
  if (!required || required.length === 0) {
    return { passed: true, code: 'OK', message: '' };
  }
  for (const lecturer of offering.lecturers) {
    if (!isLecturerEligibleForCourse(lecturer, offering.course)) {
      return {
        passed: false, code: 'COMPETENCY_MISMATCH',
        message:
          `Offering ${offering.id} (${offering.course.name}) requires competencies ` +
          `[${required.join(', ')}] but lecturer ${lecturer.name} only has ` +
          `[${lecturer.competencies.join(', ')}].`,
      };
    }
  }
  return { passed: true, code: 'OK', message: '' };
}

// ─── Check 7: Academic Policy ───────────────────────────────────
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
