/**
 * BullMQ `ga-pipeline` queue (api_design §7).
 *
 * The worker process (Phase 3 task 2 — `src/worker/index.ts`, not yet
 * implemented) will consume jobs from this queue and run the
 * `runPreGA → runSSA → runGA` pipeline. This module only stands up the
 * producer-side seam; nothing here imports the GA code.
 *
 * Note on `runId` type: api_design §7 talks about `runId` abstractly, but the
 * Prisma schema uses `String @id @default(cuid())` for `ScheduleRun.id`, so
 * `runId` is typed as `string` everywhere in this module.
 */

import { Queue, type Job, type JobsOptions, type QueueOptions } from 'bullmq';
import { getQueueRedis } from './connection';

export const GA_PIPELINE_QUEUE_NAME = 'ga-pipeline';

/**
 * Per-Redis worker concurrency for the prototype (api_design §7). Two GAs on
 * the same Redis instance would slow each other down on a single-machine
 * deployment. The worker module (Phase 3 task 2) will read this constant.
 */
export const GA_PIPELINE_DEFAULT_CONCURRENCY = 1;

/**
 * Job payload. Intentionally minimal: the worker re-reads the full
 * `ScheduleRun` row (config, semester, idempotency key, etc.) from Postgres
 * by `runId`, so we don't duplicate that state into Redis.
 */
export interface GaPipelineJobData {
  runId: string;
}

export const GA_PIPELINE_DEFAULT_JOB_OPTIONS: JobsOptions = {
  // The GA pipeline is non-idempotent and long-running — a retry would
  // re-execute the whole pipeline from scratch, double-billing CPU and
  // potentially clobbering DB state. Phase 3 task 8 wires cooperative
  // cancellation; replays are out of scope for the prototype.
  attempts: 1,
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 604_800 },
};

let cachedQueue: Queue<GaPipelineJobData> | undefined;

function buildQueue(): Queue<GaPipelineJobData> {
  const options: QueueOptions = {
    connection: getQueueRedis(),
    defaultJobOptions: GA_PIPELINE_DEFAULT_JOB_OPTIONS,
  };
  return new Queue<GaPipelineJobData>(GA_PIPELINE_QUEUE_NAME, options);
}

export function getGaPipelineQueue(): Queue<GaPipelineJobData> {
  if (!cachedQueue) {
    cachedQueue = buildQueue();
  }
  return cachedQueue;
}

/**
 * Resolve a deterministic BullMQ `jobId` so retried POSTs are deduplicated.
 *
 * `ScheduleRun.idempotencyKey` is the API-level dedupe surface (api_design
 * §7); when present we prefix it to keep the keyspace separate from the
 * runId-based jobIds. Falling back to `runId` still gives us idempotency for
 * callers that don't send the header — re-enqueueing the same run is a no-op
 * for BullMQ.
 */
function resolveJobId(runId: string, idempotencyKey?: string): string {
  if (idempotencyKey && idempotencyKey.length > 0) {
    return `idempotency:${idempotencyKey}`;
  }
  return runId;
}

export async function enqueueGaPipelineRun(
  runId: string,
  opts: { idempotencyKey?: string } = {},
): Promise<Job<GaPipelineJobData>> {
  const queue = getGaPipelineQueue();
  const jobId = resolveJobId(runId, opts.idempotencyKey);
  return queue.add(GA_PIPELINE_QUEUE_NAME, { runId }, { jobId });
}

export async function getGaPipelineJob(
  runId: string,
): Promise<Job<GaPipelineJobData> | undefined> {
  const queue = getGaPipelineQueue();
  return queue.getJob(runId);
}

/**
 * Close the queue and its underlying connection. Useful for graceful
 * shutdown and for tests that want to release the BullMQ singleton.
 */
export async function closeGaPipelineQueue(): Promise<void> {
  if (cachedQueue) {
    await cachedQueue.close();
    cachedQueue = undefined;
  }
}

/**
 * Test-only: inject a stub queue. Pass `undefined` to reset.
 */
export function setGaPipelineQueueForTests(
  queue: Queue<GaPipelineJobData> | undefined,
): void {
  cachedQueue = queue;
}
