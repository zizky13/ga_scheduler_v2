/**
 * GA checkpoint keyspace (api_design §7, techspec §7.2).
 *
 * api_design §7 mandates a "separate keyspace" from BullMQ. BullMQ's default
 * key prefix is `bull:` — checkpoint keys live under `ga:run:` per the
 * techspec §7.2 schema, so the two never collide and the namespace stays
 * scannable / flushable independently if an operator needs to drop
 * checkpoints without nuking queued jobs.
 *
 * Key format:  `ga:run:{runId}:checkpoint`
 * TTL:         3600 seconds (1 hour) per techspec §7.2.
 *
 * The payload schema mirrors techspec §7.2 verbatim. A resumed run
 * re-hydrates `population` from the saved state; the SSA result is cached
 * separately as `ga:run:{runId}:ssa` and is not part of this payload.
 */
import type { Redis } from 'ioredis';

import type { Chromosome, PreGACandidate } from '../types';
import { getQueueRedis } from './connection';

export const GA_CHECKPOINT_KEY_PREFIX = 'ga:run:';
export const GA_CHECKPOINT_KEY_SUFFIX = ':checkpoint';

const DEFAULT_TTL_SECONDS = 60 * 60; // 1h per techspec §7.2

export function gaCheckpointKey(runId: string): string {
  return `${GA_CHECKPOINT_KEY_PREFIX}${runId}${GA_CHECKPOINT_KEY_SUFFIX}`;
}

/**
 * Checkpoint payload shape per techspec §7.2. Written by the worker every
 * 10 generations during a GA run; consumed by the future resume path.
 */
export interface GACheckpointPayload {
  runId: string;
  generation: number;
  bestChromosome: Chromosome;
  bestFitness: number;
  hardViolations: number;
  population: Chromosome[];
  history: number[];
  avgHistory: number[];
  candidates: PreGACandidate[];
  checkpointedAt: string; // ISO8601
}

export async function writeCheckpoint(
  runId: string,
  payload: GACheckpointPayload,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  redis: Redis = getQueueRedis(),
): Promise<void> {
  const key = gaCheckpointKey(runId);
  const value = JSON.stringify(payload);
  await redis.set(key, value, 'EX', ttlSeconds);
}

export async function readCheckpoint(
  runId: string,
  redis: Redis = getQueueRedis(),
): Promise<GACheckpointPayload | undefined> {
  const key = gaCheckpointKey(runId);
  const raw = await redis.get(key);
  if (raw === null || raw === undefined) {
    return undefined;
  }
  return JSON.parse(raw) as GACheckpointPayload;
}

export async function deleteCheckpoint(
  runId: string,
  redis: Redis = getQueueRedis(),
): Promise<void> {
  const key = gaCheckpointKey(runId);
  await redis.del(key);
}
