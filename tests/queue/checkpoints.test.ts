import { afterEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import {
  GA_CHECKPOINT_KEY_PREFIX,
  deleteCheckpoint,
  gaCheckpointKey,
  readCheckpoint,
  writeCheckpoint,
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

describe('ga checkpoint keyspace', () => {
  it('uses a prefix that does NOT collide with BullMQ default `bull:`', () => {
    expect(GA_CHECKPOINT_KEY_PREFIX).toBe('ga-checkpoint:');
    expect(GA_CHECKPOINT_KEY_PREFIX.startsWith('bull:')).toBe(false);
  });

  it('builds the per-run key as `ga-checkpoint:<runId>`', () => {
    expect(gaCheckpointKey('42')).toBe('ga-checkpoint:42');
  });

  it('round-trips a JSON-encoded payload with the default 24h TTL', async () => {
    const { redis, store } = makeStubRedis();
    setQueueRedisForTests(redis);

    const payload = { generation: 7, bestFitness: 0.42, hardViolations: 0 };
    await writeCheckpoint('run-abc', payload);

    const stored = store.get('ga-checkpoint:run-abc');
    expect(stored).toBeDefined();
    expect(stored?.ttlSeconds).toBe(24 * 60 * 60);
    expect(JSON.parse(stored!.value)).toEqual(payload);

    const roundTripped = await readCheckpoint<typeof payload>('run-abc');
    expect(roundTripped).toEqual(payload);
  });

  it('honours an explicit TTL when provided', async () => {
    const { redis, store } = makeStubRedis();
    setQueueRedisForTests(redis);

    await writeCheckpoint('run-ttl', { x: 1 }, 60);
    expect(store.get('ga-checkpoint:run-ttl')?.ttlSeconds).toBe(60);
  });

  it('returns undefined for a missing checkpoint', async () => {
    const { redis } = makeStubRedis();
    setQueueRedisForTests(redis);

    expect(await readCheckpoint('nope')).toBeUndefined();
  });

  it('deletes the key on `deleteCheckpoint`', async () => {
    const { redis, store } = makeStubRedis();
    setQueueRedisForTests(redis);

    await writeCheckpoint('run-del', { keep: false });
    expect(store.has('ga-checkpoint:run-del')).toBe(true);

    await deleteCheckpoint('run-del');
    expect(store.has('ga-checkpoint:run-del')).toBe(false);
  });
});
