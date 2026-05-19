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

  it('rejects the experimental `skipSSA` flag (E5 firewall)', () => {
    // Phase E5 of docs/backlog_experiment.md: `GAConfig.skipSSA` is the
    // independent variable of the SSA ablation experiment and must never
    // be reachable through the public REST API. The `.strict()` modifier
    // on `gaConfigSchema` enforces this by rejecting any unknown key.
    const result = gaConfigSchema.safeParse({ ...validConfig, skipSSA: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Zod's `.strict()` reports unknown keys via `unrecognized_keys` issues
      // whose path is `[]` and whose `keys` array lists the offenders.
      const mentionsSkipSsa = result.error.issues.some(
        (i) =>
          i.path.includes('skipSSA') ||
          ((i as { keys?: string[] }).keys?.includes('skipSSA') ?? false),
      );
      expect(mentionsSkipSsa).toBe(true);
    }
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

  it('rejects a POST body that smuggles `skipSSA: true` into config (E5 firewall)', () => {
    // Backlog E5 task 27: a malicious or curious API client must not be
    // able to bypass SSA on a production run by posting
    // `{"config": {"skipSSA": true}}`. The strict `gaConfigSchema` blocks
    // this at the nested `config` level.
    const result = createScheduleRunBodySchema.safeParse({
      semesterId: 1,
      config: { ...validConfig, skipSSA: true },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const mentionsSkipSsa = result.error.issues.some(
        (i) =>
          i.path.includes('skipSSA') ||
          ((i as { keys?: string[] }).keys?.includes('skipSSA') ?? false),
      );
      expect(mentionsSkipSsa).toBe(true);
    }
  });
});
