/**
 * Dedicated ioredis client for BullMQ.
 *
 * BullMQ requires `maxRetriesPerRequest: null` and `enableOfflineQueue: true`
 * on the connection it owns — its blocking commands (`brpoplpush`, etc.) would
 * otherwise be aborted by ioredis after a single retry, killing the worker.
 * The readiness client in `src/api/lib/redis.ts` deliberately uses
 * `maxRetriesPerRequest: 1` and `enableOfflineQueue: false` so `/ready`
 * fails fast on a Redis outage. Those two requirements are mutually
 * exclusive on a single ioredis instance, so we keep two clients pointed at
 * the same Redis URL.
 *
 * Both clients share the underlying Redis instance — a single `ping()` from
 * the readiness probe is sufficient to verify the BullMQ path as well.
 */

import IORedis, { type Redis, type RedisOptions } from 'ioredis';

let cached: Redis | undefined;

function buildClient(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const options: RedisOptions = {
    lazyConnect: true,
    // Required by BullMQ — null disables ioredis's per-request retry limit so
    // BullMQ's long-running blocking commands aren't cancelled mid-flight.
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  };
  return new IORedis(url, options);
}

export function getQueueRedis(): Redis {
  if (!cached) {
    cached = buildClient();
  }
  return cached;
}

/**
 * Test-only: replace the cached BullMQ client. Mirrors
 * `src/api/lib/redis.ts:setRedisForTests`.
 */
export function setQueueRedisForTests(client: Redis | undefined): void {
  cached = client;
}
