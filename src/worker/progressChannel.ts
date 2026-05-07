/**
 * Redis pub/sub channel and event encoding shared by the worker (this file's
 * direct caller) and the SSE handler (Phase 3 task 7). Keeping the channel
 * naming and event shape in one module guarantees the producer and consumer
 * never drift.
 *
 * `runId` is `string` per the Prisma schema (`ScheduleRun.id` is a cuid),
 * not the abstract value used in api_design §7.
 */

import type { Redis } from 'ioredis';

import type { GenerationSnapshot } from '../ga/runGA';

/**
 * `RunStatus` mirrors the Prisma enum (prisma/schema.prisma:315). Repeated
 * here as a string literal union so this module stays free of `@prisma/client`
 * imports — both the worker and the future SSE handler can include it without
 * pulling Prisma into their own dependency surface.
 */
export type RunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'STAGNATED'
  | 'SSA_INFEASIBLE'
  | 'PRE_GA_EMPTY'
  | 'CANCELLED'
  | 'FAILED';

export type ProgressEvent =
  | { type: 'state'; status: RunStatus }
  | { type: 'progress'; snapshot: GenerationSnapshot }
  | { type: 'error'; message: string };

export function gaProgressChannel(runId: string): string {
  return `ga-progress:${runId}`;
}

export async function publishProgressEvent(
  redis: Redis,
  runId: string,
  event: ProgressEvent,
): Promise<number> {
  return redis.publish(gaProgressChannel(runId), JSON.stringify(event));
}
