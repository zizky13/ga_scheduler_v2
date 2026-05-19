import { describe, expect, it } from 'vitest';
import {
  createCourseOfferingBodySchema,
  updateCourseOfferingBodySchema,
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

  it('accepts a body without roomId (nullable Phase 7 migration)', () => {
    const out = createCourseOfferingBodySchema.parse({
      semesterId: 1,
      courseId: 12,
      effectiveStudentCount: 35,
      lecturerIds: [7],
    });
    expect(out.roomId).toBeUndefined();
  });

  it('accepts an explicit null roomId', () => {
    const out = createCourseOfferingBodySchema.parse({
      semesterId: 1,
      courseId: 12,
      roomId: null,
      effectiveStudentCount: 35,
      lecturerIds: [7],
    });
    expect(out.roomId).toBeNull();
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

describe('updateCourseOfferingBodySchema', () => {
  it('accepts an explicit null roomId to clear the seed room', () => {
    const out = updateCourseOfferingBodySchema.parse({ roomId: null });
    expect(out.roomId).toBeNull();
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
