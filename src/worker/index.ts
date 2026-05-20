/**
 * GA pipeline worker (api_design §7, techspec §7.1).
 *
 * Consumes the `ga-pipeline` BullMQ queue, drives `runPreGA → runSSA → runGA`
 * via the orchestrator (which builds the `CompetencyEligibilityMap` per
 * api_design §7.1), persists `ScheduleRun` / `ScheduleAssignment` /
 * `FitnessHistory` rows, and publishes `state` / `progress` / `error` events
 * on `ga-progress:<runId>`.
 *
 * The async GA loop (Phase 3 task 10) yields between generations via
 * `setImmediate`, so hooks can do real-time I/O: `onGeneration` publishes
 * progress events and buffers fitness rows for batch persistence,
 * `shouldCancel` polls Redis for the cancellation flag, and `onCheckpoint`
 * writes checkpoint snapshots to Redis — all streaming live instead of
 * arriving in a burst after the loop returns.
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

    let cancelledFlag = false;

    // Fitness rows are buffered for batch persistence after the loop.
    // Progress events and checkpoints are published in real-time via async
    // hooks (Phase 3 task 10).
    const pendingFitnessRows: Array<{
      runId: string;
      generation: number;
      bestFitness: number;
      avgFitness: number;
      hardViolations: number;
      softPenalty: number;
      competencyMismatch: number;
      loadPenalty: number;
    }> = [];

    const { response } = await runPipeline({
      offerings: inputs.offerings,
      timeSlots: inputs.timeSlots,
      rooms: inputs.rooms,
      lecturers: inputs.lecturers,
      // Phase 10 #6c: thread LockedRoom rows from the DB into the pipeline so
      // UI-created room locks actually take effect. Pre-#6c, the pipeline only
      // saw the legacy in-process proxy (`CourseOffering.{isFixed, roomId}`)
      // and ignored LockedRoom rows entirely.
      lockedRooms: inputs.lockedRooms,
      config,
      hooks: {
        async onGeneration(snapshot: GenerationSnapshot) {
          pendingFitnessRows.push({
            runId,
            generation: snapshot.generation,
            bestFitness: snapshot.bestFitness,
            avgFitness: snapshot.avgFitness,
            hardViolations: snapshot.hardViolations,
            softPenalty: snapshot.softPenalty,
            competencyMismatch: snapshot.competencyMismatch,
            loadPenalty: snapshot.loadPenalty,
          });
          await safePublish(redis, runId, { type: 'progress', snapshot });
        },
        async shouldCancel() {
          if (cancelledFlag) return true;
          if (await isCancellationRequested(runId, redis)) {
            cancelledFlag = true;
            return true;
          }
          return false;
        },
        async onCheckpoint(snapshot: GACheckpointSnapshot) {
          const payload: GACheckpointPayload = {
            runId,
            generation: snapshot.generation,
            bestChromosome: snapshot.bestChromosome,
            bestFitness: snapshot.bestFitness,
            hardViolations: snapshot.hardViolations,
            population: snapshot.population,
            history: snapshot.history,
            avgHistory: snapshot.avgHistory,
            candidates: snapshot.candidates,
            checkpointedAt: new Date().toISOString(),
          };
          try {
            await writeCheckpoint(runId, payload, undefined, redis);
          } catch (err) {
            log.warn({ err }, 'checkpoint write failed');
          }
        },
      },
    });

    if (pendingFitnessRows.length > 0) {
      await prisma.fitnessHistory.createMany({
        data: pendingFitnessRows,
        skipDuplicates: true,
      });
    }

    if (cancelledFlag) {
      await clearCancellation(runId, redis);
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
        loadPenalty: latestLoadPenalty(pendingFitnessRows),
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

function latestLoadPenalty(
  rows: Array<{ loadPenalty: number }>,
): number {
  if (rows.length === 0) return 0;
  return rows[rows.length - 1]!.loadPenalty;
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
