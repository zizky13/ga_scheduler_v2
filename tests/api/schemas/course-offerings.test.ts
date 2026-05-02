import { describe, expect, it } from 'vitest';
import {
  createCourseOfferingBodySchema,
  updateStudentCountBodySchema,
} from '../../../src/api/schemas/course-offerings';

describe('createCourseOfferingBodySchema', () => {
  it('accepts the canonical body with at least one lecturer', () => {
    const out = createCourseOfferingBodySchema.parse({
      semesterId: 1,
      courseId: 12,
      roomId: 4,
      effectiveStudentCount: 35,
      lecturerIds: [7, 9],
    });
    expect(out.lecturerIds).toEqual([7, 9]);
  });

  it('accepts admin-only fields at the schema layer (Task 4 will strip for `user`)', () => {
    const out = createCourseOfferingBodySchema.parse({
      semesterId: 1,
      courseId: 12,
      roomId: 4,
      effectiveStudentCount: 35,
      lecturerIds: [7],
      isFixed: true,
      fixedTimeSlotIds: [3, 4, 5],
    });
    expect(out.isFixed).toBe(true);
    expect(out.fixedTimeSlotIds).toEqual([3, 4, 5]);
  });

  it('rejects an empty lecturerIds array', () => {
    const result = createCourseOfferingBodySchema.safeParse({
      semesterId: 1,
      courseId: 12,
      roomId: 4,
      effectiveStudentCount: 35,
      lecturerIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative student counts', () => {
    const result = createCourseOfferingBodySchema.safeParse({
      semesterId: 1,
      courseId: 12,
      roomId: 4,
      effectiveStudentCount: -5,
      lecturerIds: [7],
    });
    expect(result.success).toBe(false);
  });
});

describe('updateStudentCountBodySchema', () => {
  it('accepts a valid student-count patch', () => {
    expect(updateStudentCountBodySchema.parse({ effectiveStudentCount: 40 })).toEqual({
      effectiveStudentCount: 40,
    });
  });

  it('rejects bodies with extra fields (strict)', () => {
    const result = updateStudentCountBodySchema.safeParse({
      effectiveStudentCount: 40,
      isFixed: true,
    });
    expect(result.success).toBe(false);
  });
});
