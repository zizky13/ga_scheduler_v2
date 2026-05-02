import { describe, expect, it } from 'vitest';
import { paginationQuerySchema } from '../../../src/api/schemas/_shared';

describe('paginationQuerySchema', () => {
  it('applies defaults when query is empty', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 50 });
  });

  it('coerces numeric strings (the shape Express delivers from req.query)', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '25' })).toEqual({
      page: 3,
      pageSize: 25,
    });
  });

  it('accepts a sort field', () => {
    expect(paginationQuerySchema.parse({ sort: '-createdAt' })).toEqual({
      page: 1,
      pageSize: 50,
      sort: '-createdAt',
    });
  });

  it('rejects pageSize > 200', () => {
    const result = paginationQuerySchema.safeParse({ pageSize: '500' });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive page values', () => {
    const result = paginationQuerySchema.safeParse({ page: '0' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown extra keys (strict)', () => {
    const result = paginationQuerySchema.safeParse({ page: 1, sneaky: 'oops' });
    expect(result.success).toBe(false);
  });
});
