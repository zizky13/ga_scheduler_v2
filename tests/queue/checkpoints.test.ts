import { afterEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import {
  GA_CHECKPOINT_KEY_PREFIX,
  GA_CHECKPOINT_KEY_SUFFIX,
  deleteCheckpoint,
  gaCheckpointKey,
  readCheckpoint,
  writeCheckpoint,
  type GACheckpointPayload,
} from '../../src/queue/checkpoints';
import { setQueueRedisForTests } from '../../src/queue/connection';

interface StubEntry {
  value: string;
  ttlSeconds?: number;
}

function makeStubRedis(): { redis: Redis; store: Map<string, StubEntry> } {
  const store = new Map<string, StubEntry>();
  const stub = {
    async set(
      key: string,
      value: string,
      mode?: string,
      ttlSeconds?: number,
    ): Promise<'OK'> {
      const entry: StubEntry =
        mode === 'EX' && typeof ttlSeconds === 'number'
          ? { value, ttlSeconds }
          : { value };
      store.set(key, entry);
      return 'OK';
    },
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      return entry ? entry.value : null;
    },
    async del(key: string): Promise<number> {
      return store.delete(key) ? 1 : 0;
    },
  };
  return { redis: stub as unknown as Redis, store };
}

afterEach(() => {
  setQueueRedisForTests(undefined);
});

function makePayload(overrides: Partial<GACheckpointPayload> = {}): GACheckpointPayload {
  return {
    runId: 'run-abc',
    generation: 10,
    bestChromosome: [],
    bestFitness: 0.42,
    hardViolations: 0,
    population: [],
    history: [0.4, 0.42],
    avgHistory: [0.3, 0.32],
    candidates: [],
    checkpointedAt: '2026-05-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('ga checkpoint keyspace', () => {
  it('uses a prefix that does NOT collide with BullMQ default `bull:`', () => {
    expect(GA_CHECKPOINT_KEY_PREFIX).toBe('ga:run:');
    expect(GA_CHECKPOINT_KEY_SUFFIX).toBe(':checkpoint');
    expect(GA_CHECKPOINT_KEY_PREFIX.startsWith('bull:')).toBe(false);
  });

  it('builds the per-run key as `ga:run:<runId>:checkpoint` (techspec §7.2)', () => {
    expect(gaCheckpointKey('42')).toBe('ga:run:42:checkpoint');
  });

  it('round-trips a JSON-encoded payload with the default 1h TTL (techspec §7.2)', async () => {
    const { redis, store } = makeStubRedis();
    setQueueRedisForTests(redis);

    const payload = makePayload();
    await writeCheckpoint('run-abc', payload);

    const stored = store.get('ga:run:run-abc:checkpoint');
    expect(stored).toBeDefined();
    expect(stored?.ttlSeconds).toBe(60 * 60);
    expect(JSON.parse(stored!.value)).toEqual(payload);

    const roundTripped = await readCheckpoint('run-abc');
    expect(roundTripped).toEqual(payload);
  });

  it('honours an explicit TTL when provided', async () => {
    const { redis, store } = makeStubRedis();
    setQueueRedisForTests(redis);

    await writeCheckpoint('run-ttl', makePayload({ runId: 'run-ttl' }), 60);
    expect(store.get('ga:run:run-ttl:checkpoint')?.ttlSeconds).toBe(60);
  });

  it('uses the explicit redis client when one is passed in', async () => {
    setQueueRedisForTests(undefined);
    const { redis, store } = makeStubRedis();

    await writeCheckpoint('run-explicit', makePayload({ runId: 'run-explicit' }), undefined, redis);
    expect(store.get('ga:run:run-explicit:checkpoint')).toBeDefined();
  });

  it('returns undefined for a missing checkpoint', async () => {
    const { redis } = makeStubRedis();
    setQueueRedisForTests(redis);

    expect(await readCheckpoint('nope')).toBeUndefined();
  });

  it('deletes the key on `deleteCheckpoint`', async () => {
    const { redis, store } = makeStubRedis();
    setQueueRedisForTests(redis);

    await writeCheckpoint('run-del', makePayload({ runId: 'run-del' }));
    expect(store.has('ga:run:run-del:checkpoint')).toBe(true);

    await deleteCheckpoint('run-del');
    expect(store.has('ga:run:run-del:checkpoint')).toBe(false);
  });
});
