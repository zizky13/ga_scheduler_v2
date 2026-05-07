/**
 * Phase 3 Task 5 — `POST /schedule-runs` route tests.
 *
 * Covers: happy path 202, idempotent replay (same key + body), 409 idempotency
 * conflict, 400 schema, 422 NO_ACTIVE_SEMESTER, 429 rate limit, 503
 * QUEUE_UNAVAILABLE, 401 unauth, audit row.
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import type { Job, Queue } from 'bullmq';

import { createServer } from '../../../src/api/server';
import { setCrudRepositoriesForTests } from '../../../src/api/lib/crudContext';
import { signAccessToken } from '../../../src/api/lib/auth';
import { setGaPipelineQueueForTests } from '../../../src/queue/ga-pipeline';
import type { GaPipelineJobData } from '../../../src/queue/ga-pipeline';
import { buildCrudFixture, type CrudFixture } from './_crudFixture';

let app: Application;
let fixture: CrudFixture;

interface QueueStub {
  queue: Queue<GaPipelineJobData>;
  addCalls: Array<{ name: string; data: GaPipelineJobData; jobId?: string }>;
  addImpl: { current: (jobId?: string) => Promise<unknown> };
}

function makeQueueStub(): QueueStub {
  const addCalls: QueueStub['addCalls'] = [];
  const addImpl: QueueStub['addImpl'] = {
    current: async (jobId) => ({ id: jobId ?? 'job-default' }) as Job<GaPipelineJobData>,
  };
  const queue = {
    add: vi.fn(async (name: string, data: GaPipelineJobData, opts?: { jobId?: string }) => {
      const call: QueueStub['addCalls'][number] = { name, data };
      if (opts?.jobId !== undefined) call.jobId = opts.jobId;
      addCalls.push(call);
      return addImpl.current(opts?.jobId);
    }),
    close: vi.fn(async () => {}),
  } as unknown as Queue<GaPipelineJobData>;
  return { queue, addCalls, addImpl };
}

let queueStub: QueueStub;

beforeEach(() => {
  // Build a fresh server per test so the rate-limit middleware's in-memory
  // sliding window does not accumulate hits across tests.
  app = createServer();
  fixture = buildCrudFixture();
  setCrudRepositoriesForTests(fixture.repos);
  queueStub = makeQueueStub();
  setGaPipelineQueueForTests(queueStub.queue);
});

afterEach(() => {
  setGaPipelineQueueForTests(undefined);
});

afterAll(() => {
  setCrudRepositoriesForTests(undefined);
});

const userBearer = () =>
  `Bearer ${signAccessToken({ id: 7, email: 'u@upj.ac.id', role: 'user' })}`;

function seedUser(): void {
  fixture.insertUser({ id: 7, email: 'u@upj.ac.id', fullName: 'U', role: 'USER' });
}

function seedSemesterWithOffering(): { semesterId: number } {
  const sem = fixture.insertSemester({ code: 'S', label: 'L' });
  const room = fixture.insertRoom({ semesterId: sem.id, name: 'R', capacity: 30 });
  const course = fixture.insertCourse({
    semesterId: sem.id,
    code: 'IF101',
    name: 'Algoritma',
    sks: 3,
  });
  fixture.insertCourseOffering({
    semesterId: sem.id,
    courseId: course.id,
    roomId: room.id,
    effectiveStudentCount: 25,
  });
  return { semesterId: sem.id };
}

function validBody(semesterId: number): Record<string, unknown> {
  return {
    semesterId,
    config: {
      populationSize: 50,
      generations: 100,
      mutationRate: 0.05,
      elitismCount: 4,
      tournamentSize: 5,
      crossoverType: 'uniform',
      noiseRate: 0.1,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    },
  };
}

describe('POST /schedule-runs', () => {
  it('401 without bearer', async () => {
    const res = await request(app).post('/api/v1/schedule-runs').send({});
    expect(res.status).toBe(401);
  });

  it('400 on schema violation (missing config)', async () => {
    seedUser();
    const { semesterId } = seedSemesterWithOffering();
    const res = await request(app)
      .post('/api/v1/schedule-runs')
      .set('Authorization', userBearer())
      .send({ semesterId });
    expect(res.status).toBe(400);
  });

  it('202 on happy path — creates QUEUED row, enqueues job, writes audit', async () => {
    seedUser();
    const { semesterId } = seedSemesterWithOffering();

    const res = await request(app)
      .post('/api/v1/schedule-runs')
      .set('Authorization', userBearer())
      .set('Idempotency-Key', 'idem-1')
      .send(validBody(semesterId));

    expect(res.status).toBe(202);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'QUEUED',
        semesterId,
        createdById: 7,
      }),
    );
    expect(typeof res.body.id).toBe('string');
    expect(typeof res.body.createdAt).toBe('string');

    // ScheduleRun row exists with the persisted body and idempotency key
    expect(fixture.scheduleRunStore.size).toBe(1);
    const row = Array.from(fixture.scheduleRunStore.values())[0]!;
    expect(row.status).toBe('QUEUED');
    expect(row.idempotencyKey).toBe('idem-1');
    expect(row.semesterId).toBe(semesterId);
    expect(JSON.parse(row.configJson)).toMatchObject({
      populationSize: 50,
      generations: 100,
    });

    // BullMQ enqueue called with the runId and the idempotency-prefixed jobId
    expect(queueStub.addCalls).toHaveLength(1);
    expect(queueStub.addCalls[0]!.data.runId).toBe(row.id);
    expect(queueStub.addCalls[0]!.jobId).toBe('idempotency:idem-1');

    // Audit row recorded
    const audit = fixture.auditLogStore.find((a) => a.action === 'schedule_run.create');
    expect(audit).toBeDefined();
    expect(audit?.entityType).toBe('ScheduleRun');
    expect(audit?.entityId).toBe(row.id);
    const meta = JSON.parse(audit!.metadata!) as Record<string, unknown>;
    expect((meta.after as Record<string, unknown>).idempotencyKey).toBe('idem-1');
  });

  it('202 on idempotent replay — same key + same body returns existing row, no new enqueue', async () => {
    seedUser();
    const { semesterId } = seedSemesterWithOffering();
    const body = validBody(semesterId);

    const first = await request(app)
      .post('/api/v1/schedule-runs')
      .set('Authorization', userBearer())
      .set('Idempotency-Key', 'idem-replay')
      .send(body);
    expect(first.status).toBe(202);

    const second = await request(app)
      .post('/api/v1/schedule-runs')
      .set('Authorization', userBearer())
      .set('Idempotency-Key', 'idem-replay')
      .send(body);
    expect(second.status).toBe(202);
    expect(second.body.id).toBe(first.body.id);

    // Still only one row, only one enqueue from the first call
    expect(fixture.scheduleRunStore.size).toBe(1);
    expect(queueStub.addCalls).toHaveLength(1);
  });

  it('202 on idempotent replay — same key + body with reordered keys still matches (canonical JSON)', async () => {
    seedUser();
    const { semesterId } = seedSemesterWithOffering();
    const baseBody = validBody(semesterId);
    const reorderedConfig = {
      // Same fields, different insertion order
      noiseRate: 0.1,
      crossoverType: 'uniform',
      tournamentSize: 5,
      elitismCount: 4,
      mutationRate: 0.05,
      generations: 100,
      populationSize: 50,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const first = await request(app)
      .post('/api/v1/schedule-runs')
      .set('Authorization', userBearer())
      .set('Idempotency-Key', 'idem-reorder')
      .send(baseBody);
    expect(first.status).toBe(202);

    const second = await request(app)
      .post('/api/v1/schedule-runs')
      .set('Authorization', userBearer())
      .set('Idempotency-Key', 'idem-reorder')
      .send({ semesterId, config: reorderedConfig });
    expect(second.status).toBe(202);
    expect(second.body.id).toBe(first.body.id);
  });

  it('409 IDEMPOTENCY_CONFLICT — same key + different body', async () => {
    seedUser();
    const { semesterId } = seedSemesterWithOffering();

    const first = await request(app)
      .post('/api/v1/schedule-runs')
      .set('Authorization', userBearer())
      .set('Idempotency-Key', 'idem-conflict')
      .send(validBody(semesterId));
    expect(first.status).toBe(202);

    const altered = validBody(semesterId);
    (altered.config as Record<string, unknown>).populationSize = 999;

    const second = await request(app)
      .post('/api/v1/schedule-runs')
      .set('Authorization', userBearer())
      .set('Idempotency-Key', 'idem-conflict')
      .send(altered);
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('422 NO_ACTIVE_SEMESTER — semester has no offerings', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    // Note: NO offerings inserted

    const res = await request(app)
      .post('/api/v1/schedule-runs')
      .set('Authorization', userBearer())
      .send(validBody(sem.id));

    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('NO_ACTIVE_SEMESTER');
    expect(fixture.scheduleRunStore.size).toBe(0);
    expect(queueStub.addCalls).toHaveLength(0);
  });

  it('503 QUEUE_UNAVAILABLE — enqueue throws; row marked FAILED', async () => {
    seedUser();
    const { semesterId } = seedSemesterWithOffering();

    queueStub.addImpl.current = async () => {
      throw new Error('Redis connection refused');
    };

    const res = await request(app)
      .post('/api/v1/schedule-runs')
      .set('Authorization', userBearer())
      .send(validBody(semesterId));

    expect(res.status).toBe(503);
    expect(res.body.error?.code).toBe('QUEUE_UNAVAILABLE');

    // Row was created then flipped to FAILED so it isn't orphaned in QUEUED
    expect(fixture.scheduleRunStore.size).toBe(1);
    const row = Array.from(fixture.scheduleRunStore.values())[0]!;
    expect(row.status).toBe('FAILED');

    // No audit row should be written when the run never made it into the queue
    expect(
      fixture.auditLogStore.find((a) => a.action === 'schedule_run.create'),
    ).toBeUndefined();
  });

  it('429 — rate limit kicks in after 5 successful runs in 5 min window', async () => {
    seedUser();
    const { semesterId } = seedSemesterWithOffering();

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/v1/schedule-runs')
        .set('Authorization', userBearer())
        .send(validBody(semesterId));
      expect(res.status).toBe(202);
    }

    const sixth = await request(app)
      .post('/api/v1/schedule-runs')
      .set('Authorization', userBearer())
      .send(validBody(semesterId));

    expect(sixth.status).toBe(429);
    expect(sixth.headers['retry-after']).toBeDefined();
  });

  it('admin can also POST and the createdById comes from req.user.id', async () => {
    fixture.insertUser({ id: 1, email: 'a@upj.ac.id', fullName: 'A', role: 'ADMIN' });
    const { semesterId } = seedSemesterWithOffering();
    const adminBearer = `Bearer ${signAccessToken({ id: 1, email: 'a@upj.ac.id', role: 'admin' })}`;

    const res = await request(app)
      .post('/api/v1/schedule-runs')
      .set('Authorization', adminBearer)
      .send(validBody(semesterId));

    expect(res.status).toBe(202);
    expect(res.body.createdById).toBe(1);
  });
});
