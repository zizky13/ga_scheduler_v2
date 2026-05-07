/**
 * GA checkpoint keyspace (api_design §7, techspec §7.2).
 *
 * api_design §7 mandates a "separate keyspace" from BullMQ. BullMQ's default
 * key prefix is `bull:` — we use `ga-checkpoint:` so the two never collide,
 * and the namespace stays scannable / flushable independently if an operator
 * needs to drop checkpoints without nuking queued jobs.
 *
 * The helpers below are typed generically because the checkpoint payload
 * schema is owned by Phase 3 task 4 (techspec §7.2). This module is the
 * keyspace seam only; do not bake a payload shape in here.
 */

import { getQueueRedis } from './connection';

export const GA_CHECKPOINT_KEY_PREFIX = 'ga-checkpoint:';

const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24h

export function gaCheckpointKey(runId: string): string {
  return `${GA_CHECKPOINT_KEY_PREFIX}${runId}`;
}

/**
 * Persist a checkpoint payload as JSON.
 *
 * TODO(Phase 3 task 4): replace `T` with the techspec §7.2 checkpoint schema
 * once that task lands. Until then, the worker passes its own type via the
 * generic parameter.
 */
export async function writeCheckpoint<T>(
  runId: string,
  payload: T,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  const redis = getQueueRedis();
  const key = gaCheckpointKey(runId);
  const value = JSON.stringify(payload);
  await redis.set(key, value, 'EX', ttlSeconds);
}

export async function readCheckpoint<T>(runId: string): Promise<T | undefined> {
  const redis = getQueueRedis();
  const key = gaCheckpointKey(runId);
  const raw = await redis.get(key);
  if (raw === null || raw === undefined) {
    return undefined;
  }
  return JSON.parse(raw) as T;
}

export async function deleteCheckpoint(runId: string): Promise<void> {
  const redis = getQueueRedis();
  const key = gaCheckpointKey(runId);
  await redis.del(key);
}
