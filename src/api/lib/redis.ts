/**
 * Single shared ioredis client.
 *
 * Phase 3 introduces BullMQ which uses ioredis internally; we add the
 * dependency here (Phase 2, task 9) so the readiness probe can ping Redis
 * without churning the dependency set when the queue lands.
 *
 * Configuration choices:
 *   - `lazyConnect: true` so `new IORedis()` does NOT open a TCP connection at
 *     module-load time. The first command (`ping()`) triggers the connect.
 *     This keeps tests that stub the readiness checker from accidentally
 *     touching localhost.
 *   - `maxRetriesPerRequest: 1` and `enableOfflineQueue: false` so a Redis
 *     outage causes commands to reject quickly instead of buffering and
 *     timing out the readiness probe.
 *
 * Tests that don't need a live Redis should NOT import this module — keep
 * Redis access behind the readiness checker seam (`./readiness.ts`) so unit
 * tests can stub it.
 */

import IORedis, { type Redis, type RedisOptions } from 'ioredis';

let cached: Redis | undefined;

function buildClient(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const options: RedisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    // Cap how long ioredis waits for the initial TCP handshake. The readiness
    // route also wraps the ping in a 1s timeout, but bounding the connect
    // attempt avoids the client thrashing if Redis is unreachable.
    connectTimeout: 1000,
  };
  return new IORedis(url, options);
}

export function getRedis(): Redis {
  if (!cached) {
    cached = buildClient();
  }
  return cached;
}

/**
 * Test-only: replace the cached client. Lets unit tests inject a stub or a
 * client pointed at a sandbox Redis without leaking that wiring into
 * production code paths.
 */
export function setRedisForTests(client: Redis | undefined): void {
  cached = client;
}
