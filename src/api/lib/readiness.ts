/**
 * Readiness checker seam for `GET /api/v1/ready` (api_design §5.3.9).
 *
 * The route depends on this module, not on `getPrisma()` / `getRedis()`
 * directly, so unit tests can inject a stub via `setReadinessCheckerForTests`
 * without provisioning a live database or Redis. This mirrors the pattern in
 * `src/repo/prisma.ts:setPrismaForTests`.
 *
 * Each ping is bounded by `PING_TIMEOUT_MS` — a probe that hangs is worse
 * than one that fails, because Kubernetes / load balancers will keep routing
 * traffic to the pod until the request actually completes. Both pings run in
 * parallel under `Promise.allSettled` so a slow DB does not delay the redis
 * verdict (or vice versa).
 */

import { getPrisma } from '../../repo/prisma';
import { getRedis } from './redis';

export const PING_TIMEOUT_MS = 1000;

export interface ReadinessChecker {
  pingDb(): Promise<boolean>;
  pingRedis(): Promise<boolean>;
}

/**
 * Race a promise against a timeout. The timer is cleared in a `finally` so a
 * fast-resolving inner promise doesn't leave a dangling handle that holds the
 * event loop open during process shutdown / tests.
 */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race<T>([
      p,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} ping timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createDefaultReadinessChecker(): ReadinessChecker {
  return {
    async pingDb(): Promise<boolean> {
      const prisma = getPrisma();
      // `SELECT 1` works on both Postgres and SQLite (OQ-3 keeps the schema
      // dialect-agnostic). Prisma's `$queryRaw` returns a row array; we don't
      // care about the value, only that the round-trip succeeded.
      await withTimeout(prisma.$queryRaw`SELECT 1`, PING_TIMEOUT_MS, 'db');
      return true;
    },
    async pingRedis(): Promise<boolean> {
      const redis = getRedis();
      const reply = await withTimeout(redis.ping(), PING_TIMEOUT_MS, 'redis');
      // ioredis returns the raw 'PONG' string on success.
      return reply === 'PONG';
    },
  };
}

let cached: ReadinessChecker | undefined;

export function getReadinessChecker(): ReadinessChecker {
  if (!cached) {
    cached = createDefaultReadinessChecker();
  }
  return cached;
}

/**
 * Test-only: replace the module-scoped checker. Pass `undefined` to reset
 * back to the default (lazily reconstructed on the next call).
 */
export function setReadinessCheckerForTests(checker: ReadinessChecker | undefined): void {
  cached = checker;
}
