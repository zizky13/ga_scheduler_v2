import { describe, expect, it } from 'vitest';
import {
  createScheduleRunBodySchema,
  gaConfigSchema,
} from '../../../src/api/schemas/schedule-runs';

const validConfig = {
  populationSize: 100,
  generations: 200,
  mutationRate: 0.05,
  elitismCount: 4,
  tournamentSize: 5,
  crossoverType: 'uniform' as const,
  noiseRate: 0.1,
  hardPenaltyWeight: 100,
  softPenaltyWeight: 1,
};

describe('gaConfigSchema', () => {
  it('accepts the api_design §5.3.8 example body verbatim', () => {
    expect(gaConfigSchema.parse(validConfig)).toEqual(validConfig);
  });

  it('applies default penalty weights when omitted (techspec §4.3 defaults 100/1)', () => {
    const { hardPenaltyWeight, softPenaltyWeight, ...partial } = validConfig;
    void hardPenaltyWeight;
    void softPenaltyWeight;
    const out = gaConfigSchema.parse(partial);
    expect(out.hardPenaltyWeight).toBe(100);
    expect(out.softPenaltyWeight).toBe(1);
  });

  it('rejects elitismCount >= populationSize', () => {
    const result = gaConfigSchema.safeParse({ ...validConfig, elitismCount: 100 });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown crossoverType', () => {
    const result = gaConfigSchema.safeParse({ ...validConfig, crossoverType: 'megaSwap' });
    expect(result.success).toBe(false);
  });
});

describe('createScheduleRunBodySchema', () => {
  it('accepts the full POST /schedule-runs body', () => {
    const out = createScheduleRunBodySchema.parse({
      semesterId: 1,
      config: validConfig,
    });
    expect(out.semesterId).toBe(1);
    expect(out.config.crossoverType).toBe('uniform');
  });

  it('rejects when semesterId is missing', () => {
    const result = createScheduleRunBodySchema.safeParse({ config: validConfig });
    expect(result.success).toBe(false);
  });

  it('rejects extra top-level fields (strict)', () => {
    const result = createScheduleRunBodySchema.safeParse({
      semesterId: 1,
      config: validConfig,
      idempotencyKey: 'should-be-a-header-not-a-body-field',
    });
    expect(result.success).toBe(false);
  });
});
