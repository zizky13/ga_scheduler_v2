import { describe, expect, it } from 'vitest';
import {
  createLecturerBodySchema,
  updateLecturerBodySchema,
} from '../../../src/api/schemas/lecturers';

describe('createLecturerBodySchema', () => {
  it('accepts the documented body and applies defaults', () => {
    const out = createLecturerBodySchema.parse({
      semesterId: 1,
      name: 'Dr. Ani',
    });
    expect(out).toEqual({
      semesterId: 1,
      name: 'Dr. Ani',
      preferredTimeSlotIds: [],
      competencies: [],
    });
  });

  it('dedupes competencies via the shared schema', () => {
    const out = createLecturerBodySchema.parse({
      semesterId: 1,
      name: 'Dr. Ani',
      competencies: ['algorithms', 'algorithms', 'databases'],
    });
    expect(out.competencies).toEqual(['algorithms', 'databases']);
  });

  it('accepts isStructural at the schema layer (Task 4 strips it for `user`)', () => {
    const out = createLecturerBodySchema.parse({
      semesterId: 1,
      name: 'Dr. Budi',
      isStructural: true,
    });
    expect(out.isStructural).toBe(true);
  });

  it('rejects missing semesterId', () => {
    const result = createLecturerBodySchema.safeParse({ name: 'Anon' });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive semesterId', () => {
    const result = createLecturerBodySchema.safeParse({ semesterId: 0, name: 'X' });
    expect(result.success).toBe(false);
  });

  it('treats maxSks as optional', () => {
    const out = createLecturerBodySchema.parse({ semesterId: 1, name: 'Dr. Ani' });
    expect(out.maxSks).toBeUndefined();
  });

  it('accepts maxSks: 0 (on-leave semantics, OQ-12)', () => {
    const out = createLecturerBodySchema.parse({ semesterId: 1, name: 'Dr. Ani', maxSks: 0 });
    expect(out.maxSks).toBe(0);
  });

  it('rejects negative maxSks', () => {
    const result = createLecturerBodySchema.safeParse({ semesterId: 1, name: 'X', maxSks: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer maxSks', () => {
    const result = createLecturerBodySchema.safeParse({ semesterId: 1, name: 'X', maxSks: 12.5 });
    expect(result.success).toBe(false);
  });
});

describe('updateLecturerBodySchema', () => {
  it('rejects an empty patch body', () => {
    const result = updateLecturerBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts a competency-only update', () => {
    const out = updateLecturerBodySchema.parse({ competencies: ['ai-ml'] });
    expect(out.competencies).toEqual(['ai-ml']);
  });

  it('accepts a maxSks-only update with 0', () => {
    const out = updateLecturerBodySchema.parse({ maxSks: 0 });
    expect(out.maxSks).toBe(0);
  });

  it('rejects negative maxSks on update', () => {
    const result = updateLecturerBodySchema.safeParse({ maxSks: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer maxSks on update', () => {
    const result = updateLecturerBodySchema.safeParse({ maxSks: 9.5 });
    expect(result.success).toBe(false);
  });
});
