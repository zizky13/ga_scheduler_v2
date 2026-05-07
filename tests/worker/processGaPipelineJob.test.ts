import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import type { GAConfig, GAResult } from '../../src/types';
import type { OrchestratorOutput } from '../../src/orchestrator';

vi.mock('../../src/orchestrator', () => ({
  runPipeline: vi.fn(),
}));
vi.mock('../../src/repo/scheduleRepo', () => ({
  loadScheduleInputs: vi.fn(async () => ({
    rooms: [],
    timeSlots: [],
    lecturers: [],
    courses: [],
    offerings: [],
    lockedRooms: [],
    lockedRoomMap: new Map(),
  })),
  getActiveSemesterId: vi.fn(),
}));
vi.mock('../../src/repo/scheduleAssignmentRepo', () => ({
  persistScheduleAssignments: vi.fn(async () => undefined),
  loadScheduleAssignments: vi.fn(),
}));

import { processGaPipelineJob } from '../../src/worker/index';
import { runPipeline } from '../../src/orchestrator';
import { persistScheduleAssignments } from '../../src/repo/scheduleAssignmentRepo';

const mockedRunPipeline = vi.mocked(runPipeline);
const mockedPersist = vi.mocked(persistScheduleAssignments);

interface ScheduleRunRecord {
  id: string;
  semesterId: number;
  status: string;
  configJson: string;
  startedAt?: Date | null;
  completedAt?: Date | null;
  preGASummaryJson?: string | null;
  ssaResultJson?: string | null;
  historyJson?: string | null;
  avgHistoryJson?: string | null;
  bestFitness?: number;
  hardViolations?: number;
  softPenalty?: number;
  competencyMismatch?: number;
  currentGeneration?: number;
  generationsRun?: number;
  stagnatedEarly?: boolean;
  durationMs?: number | null;
  errorMessage?: string | null;
}

interface PrismaStub {
  prisma: PrismaClient;
  runs: Map<string, ScheduleRunRecord>;
  fitnessRows: Array<Record<string, unknown>>;
}

function makePrismaStub(initial: ScheduleRunRecord[]): PrismaStub {
  const runs = new Map<string, ScheduleRunRecord>(initial.map((r) => [r.id, { ...r }]));
  const fitnessRows: Array<Record<string, unknown>> = [];

  const prisma = {
    scheduleRun: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = runs.get(where.id);
        return row ? { ...row } : null;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<ScheduleRunRecord>;
        }) => {
          const existing = runs.get(where.id);
          if (!existing) throw new Error(`run ${where.id} not found`);
          Object.assign(existing, data);
          return { ...existing };
        },
      ),
    },
    fitnessHistory: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const row of data) fitnessRows.push(row);
        return { count: data.length };
      }),
    },
  } as unknown as PrismaClient;

  return { prisma, runs, fitnessRows };
}

interface PublishCall {
  channel: string;
  payload: string;
}

interface SetCall {
  key: string;
  value: string;
  mode?: string;
  ttl?: number;
}

function makeRedisStub(): {
  redis: Redis;
  calls: PublishCall[];
  setCalls: SetCall[];
} {
  const calls: PublishCall[] = [];
  const setCalls: SetCall[] = [];
  const redis = {
    publish: vi.fn(async (channel: string, payload: string) => {
      calls.push({ channel, payload });
      return 1;
    }),
    set: vi.fn(async (key: string, value: string, mode?: string, ttl?: number) => {
      setCalls.push({ key, value, mode, ttl });
      return 'OK';
    }),
  } as unknown as Redis;
  return { redis, calls, setCalls };
}

const baseConfig: GAConfig = {
  populationSize: 10,
  generations: 3,
  mutationRate: 0.1,
  elitismCount: 2,
  tournamentSize: 3,
  crossoverType: 'uniform',
  noiseRate: 0.15,
  hardPenaltyWeight: 100,
  softPenaltyWeight: 1,
};

function baseRun(overrides: Partial<ScheduleRunRecord> = {}): ScheduleRunRecord {
  return {
    id: 'run-1',
    semesterId: 1,
    status: 'QUEUED',
    configJson: JSON.stringify(baseConfig),
    ...overrides,
  };
}

function decodedEvents(calls: PublishCall[]): Array<{ channel: string; event: unknown }> {
  return calls.map((c) => ({ channel: c.channel, event: JSON.parse(c.payload) }));
}

beforeEach(() => {
  mockedRunPipeline.mockReset();
  mockedPersist.mockReset();
  mockedPersist.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('processGaPipelineJob', () => {
  it('SUCCESS: drives QUEUED → RUNNING → COMPLETED, flushes fitness, persists assignments, publishes events in order', async () => {
    const { prisma, runs, fitnessRows } = makePrismaStub([baseRun()]);
    const { redis, calls } = makeRedisStub();

    const gaResult: GAResult = {
      bestChromosome: [],
      bestFitness: 0.99,
      hardViolations: 0,
      softPenalty: 5,
      history: [0.5, 0.7, 0.99],
      avgHistory: [0.4, 0.6, 0.85],
      stagnatedEarly: false,
      generationsRun: 3,
    };

    mockedRunPipeline.mockImplementation((input) => {
      input.hooks?.onGeneration?.({
        generation: 1,
        bestFitness: 0.5,
        avgFitness: 0.4,
        hardViolations: 4,
        softPenalty: 10,
        competencyMismatch: 1,
        structuralPenalty: 2,
        preferencePenalty: 1,
      });
      input.hooks?.onGeneration?.({
        generation: 2,
        bestFitness: 0.7,
        avgFitness: 0.6,
        hardViolations: 2,
        softPenalty: 8,
        competencyMismatch: 0,
        structuralPenalty: 1,
        preferencePenalty: 1,
      });
      input.hooks?.onGeneration?.({
        generation: 3,
        bestFitness: 0.99,
        avgFitness: 0.85,
        hardViolations: 0,
        softPenalty: 5,
        competencyMismatch: 0,
        structuralPenalty: 0,
        preferencePenalty: 1,
      });
      const out: OrchestratorOutput = {
        response: {
          status: 'SUCCESS',
          preGASummary: { feasible: 1, infeasible: [] },
          ssaResult: {
            status: 'FEASIBLE',
            totalSessionsRequired: 1,
            maximumAchievableMatching: 1,
          },
          gaResult,
          durationMs: 42,
        },
        context: {
          validation: { feasible: [], infeasible: [] },
          candidates: [],
          ssaResult: {
            status: 'FEASIBLE',
            totalSessionsRequired: 1,
            maximumAchievableMatching: 1,
          },
          lecturerStructuralMap: new Map(),
          lecturerPreferenceMap: new Map(),
          competencyEligibilityMap: new Map(),
        },
      };
      return out;
    });

    await processGaPipelineJob(prisma, redis, { data: { runId: 'run-1' } });

    const final = runs.get('run-1')!;
    expect(final.status).toBe('COMPLETED');
    expect(final.completedAt).toBeInstanceOf(Date);
    expect(final.startedAt).toBeInstanceOf(Date);
    expect(final.bestFitness).toBe(0.99);
    expect(final.hardViolations).toBe(0);
    expect(final.softPenalty).toBe(5);
    expect(final.generationsRun).toBe(3);
    expect(final.currentGeneration).toBe(3);
    expect(final.stagnatedEarly).toBe(false);
    expect(final.historyJson).toBe(JSON.stringify(gaResult.history));
    expect(final.avgHistoryJson).toBe(JSON.stringify(gaResult.avgHistory));
    expect(final.preGASummaryJson).toBe(JSON.stringify({ feasible: 1, infeasible: [] }));
    expect(final.ssaResultJson).toBeTruthy();

    expect(fitnessRows).toHaveLength(3);
    expect(fitnessRows[0]).toMatchObject({ runId: 'run-1', generation: 1, bestFitness: 0.5 });
    expect(fitnessRows[2]).toMatchObject({ runId: 'run-1', generation: 3, bestFitness: 0.99 });

    expect(mockedPersist).toHaveBeenCalledTimes(1);
    expect(mockedPersist).toHaveBeenCalledWith(prisma, 'run-1', gaResult.bestChromosome);

    const events = decodedEvents(calls);
    expect(events.every((e) => e.channel === 'ga-progress:run-1')).toBe(true);

    const types = events.map((e) => (e.event as { type: string }).type);
    const states = events
      .filter((e) => (e.event as { type: string }).type === 'state')
      .map((e) => (e.event as { status: string }).status);

    expect(types[0]).toBe('state');
    expect(states[0]).toBe('RUNNING');
    expect(states[states.length - 1]).toBe('COMPLETED');

    const progressTypes = events.filter((e) => (e.event as { type: string }).type === 'progress');
    expect(progressTypes).toHaveLength(3);
    expect((progressTypes[0]!.event as { snapshot: { generation: number } }).snapshot.generation).toBe(1);
    expect((progressTypes[2]!.event as { snapshot: { generation: number } }).snapshot.generation).toBe(3);
  });

  it('Checkpoint: writes latest onCheckpoint snapshot to Redis under `ga:run:<id>:checkpoint` with 1h TTL (techspec §7.2)', async () => {
    const { prisma, runs } = makePrismaStub([baseRun()]);
    const { redis, setCalls } = makeRedisStub();

    const gaResult: GAResult = {
      bestChromosome: [],
      bestFitness: 0.9,
      hardViolations: 0,
      softPenalty: 2,
      history: [0.5, 0.7, 0.9],
      avgHistory: [0.4, 0.6, 0.8],
      stagnatedEarly: false,
      generationsRun: 20,
    };

    mockedRunPipeline.mockImplementation((input) => {
      // Two checkpoint snapshots — only the latest should be persisted.
      input.hooks?.onCheckpoint?.({
        generation: 10,
        bestChromosome: [],
        bestFitness: 0.5,
        hardViolations: 3,
        population: [],
        history: [0.3, 0.5],
        avgHistory: [0.2, 0.4],
        candidates: [],
      });
      input.hooks?.onCheckpoint?.({
        generation: 20,
        bestChromosome: [],
        bestFitness: 0.9,
        hardViolations: 0,
        population: [],
        history: [0.5, 0.7, 0.9],
        avgHistory: [0.4, 0.6, 0.8],
        candidates: [],
      });
      const out: OrchestratorOutput = {
        response: {
          status: 'SUCCESS',
          preGASummary: { feasible: 1, infeasible: [] },
          ssaResult: {
            status: 'FEASIBLE',
            totalSessionsRequired: 1,
            maximumAchievableMatching: 1,
          },
          gaResult,
          durationMs: 100,
        },
        context: {
          validation: { feasible: [], infeasible: [] },
          candidates: [],
          ssaResult: {
            status: 'FEASIBLE',
            totalSessionsRequired: 1,
            maximumAchievableMatching: 1,
          },
          lecturerStructuralMap: new Map(),
          lecturerPreferenceMap: new Map(),
          competencyEligibilityMap: new Map(),
        },
      };
      return out;
    });

    await processGaPipelineJob(prisma, redis, { data: { runId: 'run-1' } });

    expect(runs.get('run-1')!.status).toBe('COMPLETED');
    expect(setCalls).toHaveLength(1);
    const checkpoint = setCalls[0]!;
    expect(checkpoint.key).toBe('ga:run:run-1:checkpoint');
    expect(checkpoint.mode).toBe('EX');
    expect(checkpoint.ttl).toBe(60 * 60);

    const payload = JSON.parse(checkpoint.value) as Record<string, unknown>;
    expect(payload.runId).toBe('run-1');
    expect(payload.generation).toBe(20);
    expect(payload.bestFitness).toBe(0.9);
    expect(payload.hardViolations).toBe(0);
    expect(payload.history).toEqual([0.5, 0.7, 0.9]);
    expect(payload.avgHistory).toEqual([0.4, 0.6, 0.8]);
    expect(typeof payload.checkpointedAt).toBe('string');
    expect(() => new Date(payload.checkpointedAt as string).toISOString()).not.toThrow();
  });

  it('Checkpoint: no Redis SET issued when onCheckpoint never fires', async () => {
    const { prisma } = makePrismaStub([baseRun()]);
    const { redis, setCalls } = makeRedisStub();

    const gaResult: GAResult = {
      bestChromosome: [],
      bestFitness: 0.4,
      hardViolations: 1,
      softPenalty: 5,
      history: [0.4],
      avgHistory: [0.3],
      stagnatedEarly: false,
      generationsRun: 1,
    };

    mockedRunPipeline.mockImplementation((input) => {
      input.hooks?.onGeneration?.({
        generation: 1,
        bestFitness: 0.4,
        avgFitness: 0.3,
        hardViolations: 1,
        softPenalty: 5,
        competencyMismatch: 0,
        structuralPenalty: 0,
        preferencePenalty: 5,
      });
      const out: OrchestratorOutput = {
        response: {
          status: 'SUCCESS',
          preGASummary: { feasible: 1, infeasible: [] },
          ssaResult: {
            status: 'FEASIBLE',
            totalSessionsRequired: 1,
            maximumAchievableMatching: 1,
          },
          gaResult,
          durationMs: 5,
        },
        context: {
          validation: { feasible: [], infeasible: [] },
          candidates: [],
          ssaResult: {
            status: 'FEASIBLE',
            totalSessionsRequired: 1,
            maximumAchievableMatching: 1,
          },
          lecturerStructuralMap: new Map(),
          lecturerPreferenceMap: new Map(),
          competencyEligibilityMap: new Map(),
        },
      };
      return out;
    });

    await processGaPipelineJob(prisma, redis, { data: { runId: 'run-1' } });

    expect(setCalls).toHaveLength(0);
  });

  it('NO_FEASIBLE_CANDIDATES: ends at PRE_GA_EMPTY, no assignments persisted', async () => {
    const { prisma, runs } = makePrismaStub([baseRun()]);
    const { redis, calls } = makeRedisStub();

    mockedRunPipeline.mockReturnValue({
      response: {
        status: 'NO_FEASIBLE_CANDIDATES',
        preGASummary: {
          feasible: 0,
          infeasible: [{ offeringId: 1, code: 'INTEGRITY_NO_COURSE', message: 'x' }],
        },
        durationMs: 5,
      },
      context: {
        validation: { feasible: [], infeasible: [] },
        candidates: [],
        lecturerStructuralMap: new Map(),
        lecturerPreferenceMap: new Map(),
        competencyEligibilityMap: new Map(),
      },
    });

    await processGaPipelineJob(prisma, redis, { data: { runId: 'run-1' } });

    expect(runs.get('run-1')!.status).toBe('PRE_GA_EMPTY');
    expect(mockedPersist).not.toHaveBeenCalled();

    const states = decodedEvents(calls)
      .filter((e) => (e.event as { type: string }).type === 'state')
      .map((e) => (e.event as { status: string }).status);
    expect(states[0]).toBe('RUNNING');
    expect(states[states.length - 1]).toBe('PRE_GA_EMPTY');
  });

  it('INFEASIBLE: ends at SSA_INFEASIBLE, no assignments persisted', async () => {
    const { prisma, runs } = makePrismaStub([baseRun()]);
    const { redis, calls } = makeRedisStub();

    mockedRunPipeline.mockReturnValue({
      response: {
        status: 'INFEASIBLE',
        preGASummary: { feasible: 1, infeasible: [] },
        ssaResult: {
          status: 'INFEASIBLE',
          totalSessionsRequired: 5,
          maximumAchievableMatching: 3,
          deadlockReport: {
            code: 'BIPARTITE_MATCHING_INSUFFICIENT',
            message: 'short',
            affectedOfferingIds: [1, 2],
            recommendation: 'add slots',
          },
        },
        durationMs: 12,
      },
      context: {
        validation: { feasible: [], infeasible: [] },
        candidates: [],
        ssaResult: {
          status: 'INFEASIBLE',
          totalSessionsRequired: 5,
          maximumAchievableMatching: 3,
        },
        lecturerStructuralMap: new Map(),
        lecturerPreferenceMap: new Map(),
        competencyEligibilityMap: new Map(),
      },
    });

    await processGaPipelineJob(prisma, redis, { data: { runId: 'run-1' } });

    const final = runs.get('run-1')!;
    expect(final.status).toBe('SSA_INFEASIBLE');
    expect(final.ssaResultJson).toContain('BIPARTITE_MATCHING_INSUFFICIENT');
    expect(mockedPersist).not.toHaveBeenCalled();

    const states = decodedEvents(calls)
      .filter((e) => (e.event as { type: string }).type === 'state')
      .map((e) => (e.event as { status: string }).status);
    expect(states[states.length - 1]).toBe('SSA_INFEASIBLE');
  });

  it('STAGNATED: ends at STAGNATED when gaResult.stagnatedEarly is true', async () => {
    const { prisma, runs } = makePrismaStub([baseRun()]);
    const { redis, calls } = makeRedisStub();

    const gaResult: GAResult = {
      bestChromosome: [],
      bestFitness: 0.3,
      hardViolations: 4,
      softPenalty: 10,
      history: [0.3],
      avgHistory: [0.2],
      stagnatedEarly: true,
      generationsRun: 100,
    };

    mockedRunPipeline.mockReturnValue({
      response: {
        status: 'SUCCESS',
        preGASummary: { feasible: 1, infeasible: [] },
        ssaResult: {
          status: 'FEASIBLE',
          totalSessionsRequired: 1,
          maximumAchievableMatching: 1,
        },
        gaResult,
        durationMs: 1000,
      },
      context: {
        validation: { feasible: [], infeasible: [] },
        candidates: [],
        ssaResult: {
          status: 'FEASIBLE',
          totalSessionsRequired: 1,
          maximumAchievableMatching: 1,
        },
        lecturerStructuralMap: new Map(),
        lecturerPreferenceMap: new Map(),
        competencyEligibilityMap: new Map(),
      },
    });

    await processGaPipelineJob(prisma, redis, { data: { runId: 'run-1' } });

    expect(runs.get('run-1')!.status).toBe('STAGNATED');
    expect(runs.get('run-1')!.stagnatedEarly).toBe(true);
    expect(mockedPersist).toHaveBeenCalledTimes(1);

    const states = decodedEvents(calls)
      .filter((e) => (e.event as { type: string }).type === 'state')
      .map((e) => (e.event as { status: string }).status);
    expect(states[states.length - 1]).toBe('STAGNATED');
  });

  it('Error: thrown error from runPipeline → status FAILED, error event published, error re-thrown', async () => {
    const { prisma, runs } = makePrismaStub([baseRun()]);
    const { redis, calls } = makeRedisStub();

    mockedRunPipeline.mockImplementation(() => {
      throw new Error('boom in pipeline');
    });

    await expect(
      processGaPipelineJob(prisma, redis, { data: { runId: 'run-1' } }),
    ).rejects.toThrow('boom in pipeline');

    const final = runs.get('run-1')!;
    expect(final.status).toBe('FAILED');
    expect(final.errorMessage).toBe('boom in pipeline');

    const events = decodedEvents(calls).map((e) => e.event as { type: string; status?: string; message?: string });
    expect(events.some((e) => e.type === 'error' && e.message === 'boom in pipeline')).toBe(true);
    expect(events.some((e) => e.type === 'state' && e.status === 'FAILED')).toBe(true);
  });

  it('Already cancelled: short-circuits, no work done, single CANCELLED state event', async () => {
    const { prisma, runs, fitnessRows } = makePrismaStub([
      baseRun({ status: 'CANCELLED' }),
    ]);
    const { redis, calls } = makeRedisStub();

    await processGaPipelineJob(prisma, redis, { data: { runId: 'run-1' } });

    expect(runs.get('run-1')!.status).toBe('CANCELLED');
    expect(mockedRunPipeline).not.toHaveBeenCalled();
    expect(mockedPersist).not.toHaveBeenCalled();
    expect(fitnessRows).toHaveLength(0);

    const events = decodedEvents(calls).map((e) => e.event as { type: string; status?: string });
    expect(events).toEqual([{ type: 'state', status: 'CANCELLED' }]);
  });

  it('throws if ScheduleRun row is missing', async () => {
    const { prisma } = makePrismaStub([]);
    const { redis } = makeRedisStub();

    await expect(
      processGaPipelineJob(prisma, redis, { data: { runId: 'missing' } }),
    ).rejects.toThrow(/missing/);
  });
});
