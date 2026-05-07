import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job, Queue } from 'bullmq';
import {
  GA_PIPELINE_QUEUE_NAME,
  GA_PIPELINE_DEFAULT_CONCURRENCY,
  GA_PIPELINE_DEFAULT_JOB_OPTIONS,
  enqueueGaPipelineRun,
  setGaPipelineQueueForTests,
  type GaPipelineJobData,
} from '../../src/queue/ga-pipeline';

interface AddCall {
  name: string;
  data: GaPipelineJobData;
  opts: { jobId?: string } | undefined;
}

function makeStubQueue(): { queue: Queue<GaPipelineJobData>; calls: AddCall[] } {
  const calls: AddCall[] = [];
  const stub = {
    name: GA_PIPELINE_QUEUE_NAME,
    add: vi.fn(
      async (
        name: string,
        data: GaPipelineJobData,
        opts?: { jobId?: string },
      ): Promise<Job<GaPipelineJobData>> => {
        calls.push({ name, data, opts });
        return { id: opts?.jobId, name, data } as unknown as Job<GaPipelineJobData>;
      },
    ),
  };
  return { queue: stub as unknown as Queue<GaPipelineJobData>, calls };
}

afterEach(() => {
  setGaPipelineQueueForTests(undefined);
});

describe('ga-pipeline queue', () => {
  it('exports the canonical queue name from api_design §7', () => {
    expect(GA_PIPELINE_QUEUE_NAME).toBe('ga-pipeline');
  });

  it('exposes the per-Redis concurrency cap from api_design §7', () => {
    expect(GA_PIPELINE_DEFAULT_CONCURRENCY).toBe(1);
  });

  it('uses attempts=1 by default — the GA is not idempotent so retries are unsafe', () => {
    expect(GA_PIPELINE_DEFAULT_JOB_OPTIONS.attempts).toBe(1);
  });

  it('uses runId as the BullMQ jobId by default so retried POSTs dedupe', async () => {
    const { queue, calls } = makeStubQueue();
    setGaPipelineQueueForTests(queue);

    await enqueueGaPipelineRun('123');

    expect(calls).toHaveLength(1);
    expect(calls[0].data).toEqual({ runId: '123' });
    expect(calls[0].opts?.jobId).toBe('123');
  });

  it('prefers the idempotency key (with idempotency: prefix) when provided', async () => {
    const { queue, calls } = makeStubQueue();
    setGaPipelineQueueForTests(queue);

    await enqueueGaPipelineRun('123', { idempotencyKey: 'abc' });

    expect(calls).toHaveLength(1);
    expect(calls[0].opts?.jobId).toBe('idempotency:abc');
  });

  it('falls back to runId when idempotencyKey is empty', async () => {
    const { queue, calls } = makeStubQueue();
    setGaPipelineQueueForTests(queue);

    await enqueueGaPipelineRun('999', { idempotencyKey: '' });

    expect(calls[0].opts?.jobId).toBe('999');
  });
});
