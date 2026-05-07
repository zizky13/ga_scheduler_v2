/**
 * Redis-backed cancellation flag for GA pipeline runs (api_design §7).
 *
 * Key format:  `ga:run:{runId}:cancel`
 * TTL:         600 seconds (10 minutes) — well beyond the §1.2 P1 budget of
 *              "< 10 minutes" per run. The key self-expires so orphaned flags
 *              don't leak.
 *
 * The API sets the flag via `requestCancellation`; the worker polls it via
 * `isCancellationRequested`. The GA loop's `shouldCancel` hook calls the
 * latter synchronously — once Phase 3 task 10 makes the loop yield, the
 * async Redis GET fires between generations.
 *
 * Until task 10 lands, the worker pre-checks before entering the sync loop
 * and the flag takes effect between BullMQ jobs (concurrency boundary).
 */
import type { Redis } from 'ioredis';

import { getQueueRedis } from './connection';

const KEY_PREFIX = 'ga:run:';
const KEY_SUFFIX = ':cancel';
const DEFAULT_TTL_SECONDS = 600;

export function gaCancelKey(runId: string): string {
  return `${KEY_PREFIX}${runId}${KEY_SUFFIX}`;
}

export async function requestCancellation(
  runId: string,
  redis: Redis = getQueueRedis(),
): Promise<void> {
  await redis.set(gaCancelKey(runId), '1', 'EX', DEFAULT_TTL_SECONDS);
}

export async function isCancellationRequested(
  runId: string,
  redis: Redis = getQueueRedis(),
): Promise<boolean> {
  const val = await redis.get(gaCancelKey(runId));
  return val !== null;
}

export async function clearCancellation(
  runId: string,
  redis: Redis = getQueueRedis(),
): Promise<void> {
  await redis.del(gaCancelKey(runId));
}
