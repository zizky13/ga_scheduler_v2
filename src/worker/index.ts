/**
 * GA pipeline worker (api_design §7, techspec §7.1).
 *
 * Consumes the `ga-pipeline` BullMQ queue, drives `runPreGA → runSSA → runGA`
 * via the orchestrator (which builds the `CompetencyEligibilityMap` per
 * api_design §7.1), persists `ScheduleRun` / `ScheduleAssignment` /
 * `FitnessHistory` rows, and publishes `state` / `progress` / `error` events
 * on `ga-progress:<runId>`.
 *
 * Buffering note: the GA loop in `src/ga/runGA.ts` is currently synchronous
 * (no `await`, no `setImmediate`), so async work scheduled from inside the
 * `onGeneration` hook would queue up behind the loop and never drain mid-run.
 * Phase 3 task 10 refactors the loop to yield. Until then this worker buffers
 * the per-generation snapshots in memory and flushes them after `runPipeline`
 * returns. Events are still persisted and published in order — they just
 * arrive in a single burst at the end rather than streaming live.
 */

import { Worker, type Job } from 'bullmq';
import { PrismaClient, type ScheduleRun } from '@prisma/client';
import type { Redis } from 'ioredis';

import {
  GA_PIPELINE_QUEUE_NAME,
  GA_PIPELINE_DEFAULT_CONCURRENCY,
  closeGaPipelineQueue,
  type GaPipelineJobData,
} from '../queue/ga-pipeline';
import { getQueueRedis } from '../queue/connection';
import { runPipeline } from '../orchestrator';
import { loadScheduleInputs } from '../repo/scheduleRepo';
import { persistScheduleAssignments } from '../repo/scheduleAssignmentRepo';
import { getRootLogger } from '../api/logger';
import type { GAConfig } from '../types';
import type { GACheckpointSnapshot, GenerationSnapshot } from '../ga/runGA';
import { writeCheckpoint, type GACheckpointPayload } from '../queue/checkpoints';
import {
  gaProgressChannel,
  publishProgressEvent,
  type ProgressEvent,
  type RunStatus,
} from './progressChannel';
import { isCancellationRequested, clearCancellation } from '../queue/cancellation';

const logger = getRootLogger();

interface CreateWorkerOpts {
  prisma?: PrismaClient;
  redis?: Redis;
  concurrency?: number;
}

export function createGaPipelineWorker(opts: CreateWorkerOpts = {}): Worker<GaPipelineJobData> {
  const prisma = opts.prisma ?? new PrismaClient();
  const redis = opts.redis ?? getQueueRedis();
  const concurrency = opts.concurrency ?? GA_PIPELINE_DEFAULT_CONCURRENCY;

  return new Worker<GaPipelineJobData>(
    GA_PIPELINE_QUEUE_NAME,
    async (job) => {
      await processGaPipelineJob(prisma, redis, job);
    },
    { connection: redis, concurrency },
  );
}

export interface ProcessableJob {
  data: GaPipelineJobData;
  id?: string | undefined;
}

export async function processGaPipelineJob(
  prisma: PrismaClient,
  redis: Redis,
  job: ProcessableJob | Job<GaPipelineJobData>,
): Promise<void> {
  const { runId } = job.data;
  const log = logger.child({ runId, jobId: 'id' in job ? job.id : undefined });

  const run = await prisma.scheduleRun.findUnique({ where: { id: runId } });
  if (!run) {
    throw new Error(`ScheduleRun ${runId} not found`);
  }

  // Check both DB status and Redis cancellation key — the cancel endpoint
  // sets both, and either one is sufficient to skip the run.
  if (run.status === 'CANCELLED' || await isCancellationRequested(runId, redis)) {
    log.info('Run already cancelled — emitting final state and exiting');
    if (run.status !== 'CANCELLED') {
      await prisma.scheduleRun.update({
        where: { id: runId },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
    }
    await safePublish(redis, runId, { type: 'state', status: 'CANCELLED' });
    await clearCancellation(runId, redis);
    return;
  }

  try {
    await prisma.scheduleRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    await safePublish(redis, runId, { type: 'state', status: 'RUNNING' });

    const config = parseConfig(run.configJson);
    const inputs = await loadScheduleInputs(prisma, run.semesterId);

    // Mutable flag read synchronously by the GA loop's shouldCancel hook.
    // The cancel endpoint sets a Redis key; we poll it here before the
    // sync loop starts (and after task 10 yields, between generations).
    let cancelledFlag = false;

    const pendingFitnessRows: Array<{
      runId: string;
      generation: number;
      bestFitness: number;
      avgFitness: number;
      hardViolations: number;
      softPenalty: number;
      competencyMismatch: number;
    }> = [];
    const pendingProgressEvents: ProgressEvent[] = [];
    let latestCheckpointSnapshot: GACheckpointSnapshot | undefined;

    const { response } = runPipeline({
      offerings: inputs.offerings,
      timeSlots: inputs.timeSlots,
      rooms: inputs.rooms,
      lecturers: inputs.lecturers,
      config,
      hooks: {
        onGeneration: (snapshot: GenerationSnapshot) => {
          pendingFitnessRows.push({
            runId,
            generation: snapshot.generation,
            bestFitness: snapshot.bestFitness,
            avgFitness: snapshot.avgFitness,
            hardViolations: snapshot.hardViolations,
            softPenalty: snapshot.softPenalty,
            competencyMismatch: snapshot.competencyMismatch,
          });
          pendingProgressEvents.push({ type: 'progress', snapshot });
        },
        shouldCancel: () => cancelledFlag,
        onCheckpoint: (snapshot: GACheckpointSnapshot) => {
          latestCheckpointSnapshot = snapshot;
        },
      },
    });

    // After the sync loop returns, check whether cancellation was requested
    // while the loop was running. If so, mark the run CANCELLED instead of
    // the normal terminal status.
    if (await isCancellationRequested(runId, redis)) {
      cancelledFlag = true;
    }

    if (latestCheckpointSnapshot) {
      const payload: GACheckpointPayload = {
        runId,
        generation: latestCheckpointSnapshot.generation,
        bestChromosome: latestCheckpointSnapshot.bestChromosome,
        bestFitness: latestCheckpointSnapshot.bestFitness,
        hardViolations: latestCheckpointSnapshot.hardViolations,
        population: latestCheckpointSnapshot.population,
        history: latestCheckpointSnapshot.history,
        avgHistory: latestCheckpointSnapshot.avgHistory,
        candidates: latestCheckpointSnapshot.candidates,
        checkpointedAt: new Date().toISOString(),
      };
      try {
        await writeCheckpoint(runId, payload, undefined, redis);
      } catch (err) {
        // Don't fail the whole run if checkpointing fails — checkpoints are
        // a recovery aid, not a correctness requirement.
        log.warn({ err }, 'checkpoint write failed');
      }
    }

    if (pendingFitnessRows.length > 0) {
      await prisma.fitnessHistory.createMany({
        data: pendingFitnessRows,
        skipDuplicates: true,
      });
    }

    // Use allSettled so a transient Redis error on one publish doesn't
    // discard the rest of the buffered events or fail the whole job.
    await Promise.allSettled(
      pendingProgressEvents.map((event) => publishProgressEvent(redis, runId, event)),
    );

    // Cooperative cancellation: if the flag was set while the pipeline ran
    // (or was set before but the sync loop couldn't yield to check), honour
    // it now. The cancel endpoint already set status=CANCELLED in the DB;
    // we just need to publish the terminal event and clean up.
    if (cancelledFlag) {
      await clearCancellation(runId, redis);
      // Re-check DB — the cancel endpoint may have already set CANCELLED.
      const currentRun = await prisma.scheduleRun.findUnique({ where: { id: runId } });
      if (currentRun && currentRun.status !== 'CANCELLED') {
        await prisma.scheduleRun.update({
          where: { id: runId },
          data: { status: 'CANCELLED', completedAt: new Date() },
        });
      }
      await safePublish(redis, runId, { type: 'state', status: 'CANCELLED' });
      log.info('Run cancelled cooperatively');
      return;
    }

    if (response.status === 'NO_FEASIBLE_CANDIDATES') {
      await prisma.scheduleRun.update({
        where: { id: runId },
        data: {
          status: 'PRE_GA_EMPTY',
          preGASummaryJson: JSON.stringify(response.preGASummary),
          durationMs: response.durationMs,
          completedAt: new Date(),
        },
      });
      await safePublish(redis, runId, { type: 'state', status: 'PRE_GA_EMPTY' });
      log.info('Run terminated PRE_GA_EMPTY');
      return;
    }

    if (response.status === 'INFEASIBLE') {
      await prisma.scheduleRun.update({
        where: { id: runId },
        data: {
          status: 'SSA_INFEASIBLE',
          preGASummaryJson: JSON.stringify(response.preGASummary),
          ssaResultJson: JSON.stringify(response.ssaResult),
          durationMs: response.durationMs,
          completedAt: new Date(),
        },
      });
      await safePublish(redis, runId, { type: 'state', status: 'SSA_INFEASIBLE' });
      log.info('Run terminated SSA_INFEASIBLE');
      return;
    }

    const gaResult = response.gaResult!;
    const terminalStatus: RunStatus = gaResult.stagnatedEarly ? 'STAGNATED' : 'COMPLETED';

    await prisma.scheduleRun.update({
      where: { id: runId },
      data: {
        preGASummaryJson: JSON.stringify(response.preGASummary),
        ssaResultJson: JSON.stringify(response.ssaResult),
        historyJson: JSON.stringify(gaResult.history),
        avgHistoryJson: JSON.stringify(gaResult.avgHistory),
        bestFitness: gaResult.bestFitness,
        hardViolations: gaResult.hardViolations,
        softPenalty: gaResult.softPenalty,
        competencyMismatch: latestCompetencyMismatch(pendingFitnessRows),
        currentGeneration: gaResult.generationsRun,
        generationsRun: gaResult.generationsRun,
        stagnatedEarly: gaResult.stagnatedEarly,
        durationMs: response.durationMs,
      },
    });

    await persistScheduleAssignments(prisma, runId, gaResult.bestChromosome);

    await prisma.scheduleRun.update({
      where: { id: runId },
      data: { status: terminalStatus, completedAt: new Date() },
    });
    await safePublish(redis, runId, { type: 'state', status: terminalStatus });
    log.info({ status: terminalStatus }, 'Run completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'Worker job failed');
    await prisma.scheduleRun
      .update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          errorMessage: message,
          completedAt: new Date(),
        },
      })
      .catch((updateErr) => log.error({ updateErr }, 'Failed to mark run FAILED'));
    await safePublish(redis, runId, { type: 'error', message });
    await safePublish(redis, runId, { type: 'state', status: 'FAILED' });
    throw err;
  }
}

function parseConfig(configJson: string): GAConfig {
  return JSON.parse(configJson) as GAConfig;
}

function latestCompetencyMismatch(
  rows: Array<{ competencyMismatch: number }>,
): number {
  if (rows.length === 0) return 0;
  return rows[rows.length - 1]!.competencyMismatch;
}

async function safePublish(
  redis: Redis,
  runId: string,
  event: ProgressEvent,
): Promise<void> {
  try {
    await publishProgressEvent(redis, runId, event);
  } catch (err) {
    logger.warn({ err, runId, channel: gaProgressChannel(runId) }, 'progress publish failed');
  }
}

// Re-export `ScheduleRun` so consumers (and tests) have a stable type surface.
export type { ScheduleRun };

if (require.main === module) {
  const prisma = new PrismaClient();
  const redis = getQueueRedis();
  const worker = createGaPipelineWorker({ prisma, redis });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'GA pipeline job failed');
  });
  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'GA pipeline job completed');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Worker shutting down');
    try {
      await worker.close();
      await closeGaPipelineQueue();
      await prisma.$disconnect();
      await redis.quit();
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.info(
    { queue: GA_PIPELINE_QUEUE_NAME, concurrency: GA_PIPELINE_DEFAULT_CONCURRENCY },
    'GA pipeline worker started',
  );
}
