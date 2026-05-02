import { describe, expect, it } from 'vitest';
import { competencyArraySchema } from '../../../src/api/schemas/_shared';

describe('competencyArraySchema', () => {
  it('accepts an empty array (open assignment)', () => {
    expect(competencyArraySchema.parse([])).toEqual([]);
  });

  it('trims, dedupes, and preserves casing', () => {
    const input = ['  algorithms  ', 'algorithms', 'Databases'];
    const out = competencyArraySchema.parse(input);
    expect(out).toEqual(['algorithms', 'Databases']);
  });

  it('preserves original order on first occurrence', () => {
    const out = competencyArraySchema.parse(['ai-ml', 'algorithms', 'ai-ml', 'databases']);
    expect(out).toEqual(['ai-ml', 'algorithms', 'databases']);
  });

  it('rejects empty string entries', () => {
    const result = competencyArraySchema.safeParse(['algorithms', '   ']);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/empty competency tag/u);
    }
  });

  it('rejects more than 32 tags', () => {
    const tags = Array.from({ length: 33 }, (_, i) => `tag-${i}`);
    const result = competencyArraySchema.safeParse(tags);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/max 32/u);
    }
  });

  it('rejects non-string entries', () => {
    const result = competencyArraySchema.safeParse(['ok', 42]);
    expect(result.success).toBe(false);
  });
});
