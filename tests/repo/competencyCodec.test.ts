import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  encodeCompetencies,
  decodeCompetencies,
  getCompetencyTarget,
} from '../../src/repo/competencyCodec';

describe('competencyCodec', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('encode/decode round-trip', () => {
    it('round-trips on the postgres target (array form)', () => {
      const input = ['algorithms', 'databases', 'ai-ml'];
      const encoded = encodeCompetencies(input, 'postgres');
      expect(Array.isArray(encoded)).toBe(true);
      expect(decodeCompetencies(encoded as string[])).toEqual(input);
    });

    it('round-trips on the sqlite target (JSON-encoded form)', () => {
      const input = ['algorithms', 'databases', 'ai-ml'];
      const encoded = encodeCompetencies(input, 'sqlite');
      expect(typeof encoded).toBe('string');
      expect(encoded).toBe('["algorithms","databases","ai-ml"]');
      expect(decodeCompetencies(encoded as string)).toEqual(input);
    });

    it('round-trips an empty array on postgres', () => {
      const encoded = encodeCompetencies([], 'postgres');
      expect(encoded).toEqual([]);
      expect(decodeCompetencies(encoded as string[])).toEqual([]);
    });

    it('round-trips an empty array on sqlite as "[]"', () => {
      const encoded = encodeCompetencies([], 'sqlite');
      expect(encoded).toBe('[]');
      expect(decodeCompetencies(encoded as string)).toEqual([]);
    });
  });

  describe('decodeCompetencies — empty/null inputs', () => {
    it('returns [] for null', () => {
      expect(decodeCompetencies(null)).toEqual([]);
    });

    it('returns [] for undefined', () => {
      expect(decodeCompetencies(undefined)).toEqual([]);
    });

    it('returns [] for empty string', () => {
      expect(decodeCompetencies('')).toEqual([]);
    });

    it('returns [] for the JSON-encoded empty array "[]"', () => {
      expect(decodeCompetencies('[]')).toEqual([]);
    });

    it('returns [] for a native empty array', () => {
      expect(decodeCompetencies([])).toEqual([]);
    });
  });

  describe('decodeCompetencies — malformed input', () => {
    it('throws on malformed JSON', () => {
      expect(() => decodeCompetencies('not-json')).toThrow(/Invalid competency JSON/);
    });

    it('throws when JSON decodes to a non-array (object)', () => {
      expect(() => decodeCompetencies('{"a":1}')).toThrow(/Invalid competency JSON/);
    });

    it('throws when JSON decodes to a non-array (number)', () => {
      expect(() => decodeCompetencies('42')).toThrow(/Invalid competency JSON/);
    });

    it('throws on JSON array containing non-string elements', () => {
      expect(() => decodeCompetencies('[1, 2, 3]')).toThrow(
        /expected string, got number/,
      );
    });

    it('throws on a native array containing a number', () => {
      expect(() => decodeCompetencies([42 as unknown as string])).toThrow(
        /expected string, got number/,
      );
    });

    it('throws on a native array containing an empty string', () => {
      expect(() => decodeCompetencies(['valid', ''])).toThrow(/Empty competency tag/);
    });

    it('throws on JSON array with whitespace-only entries', () => {
      expect(() => decodeCompetencies('["valid", "   "]')).toThrow(
        /Empty competency tag/,
      );
    });
  });

  describe('encodeCompetencies — validation', () => {
    it('rejects empty-after-trim entries on postgres', () => {
      expect(() => encodeCompetencies(['  trim  ', '   '], 'postgres')).toThrow(
        /Empty competency tag/,
      );
    });

    it('rejects empty-after-trim entries on sqlite', () => {
      expect(() => encodeCompetencies(['  trim  ', '   '], 'sqlite')).toThrow(
        /Empty competency tag/,
      );
    });

    it('trims surrounding whitespace and keeps the trimmed value (postgres)', () => {
      const result = encodeCompetencies(['  trim  '], 'postgres') as string[];
      expect(result).toEqual(['trim']);
    });

    it('trims surrounding whitespace and keeps the trimmed value (sqlite)', () => {
      const result = encodeCompetencies(['  trim  '], 'sqlite') as string;
      expect(result).toBe('["trim"]');
    });

    it('rejects non-string elements', () => {
      expect(() =>
        encodeCompetencies([42 as unknown as string], 'postgres'),
      ).toThrow(/expected string, got number/);
    });

    it('rejects a non-array input outright', () => {
      expect(() =>
        encodeCompetencies('algorithms' as unknown as string[], 'postgres'),
      ).toThrow(/expected an array/);
    });
  });

  describe('getCompetencyTarget', () => {
    it("defaults to 'postgres' when DATABASE_PROVIDER is unset", () => {
      vi.stubEnv('DATABASE_PROVIDER', '');
      expect(getCompetencyTarget()).toBe('postgres');
    });

    it("returns 'postgres' when DATABASE_PROVIDER=postgres", () => {
      vi.stubEnv('DATABASE_PROVIDER', 'postgres');
      expect(getCompetencyTarget()).toBe('postgres');
    });

    it("returns 'postgres' when DATABASE_PROVIDER=postgresql", () => {
      vi.stubEnv('DATABASE_PROVIDER', 'postgresql');
      expect(getCompetencyTarget()).toBe('postgres');
    });

    it("returns 'sqlite' when DATABASE_PROVIDER=sqlite", () => {
      vi.stubEnv('DATABASE_PROVIDER', 'sqlite');
      expect(getCompetencyTarget()).toBe('sqlite');
    });

    it('is case-insensitive', () => {
      vi.stubEnv('DATABASE_PROVIDER', 'SQLite');
      expect(getCompetencyTarget()).toBe('sqlite');
    });

    it('throws on an unrecognized DATABASE_PROVIDER', () => {
      vi.stubEnv('DATABASE_PROVIDER', 'mysql');
      expect(() => getCompetencyTarget()).toThrow(/Invalid DATABASE_PROVIDER/);
    });
  });
});
