/**
 * Phase 3 Task 5 — `POST /schedule-runs` route tests.
 * Phase 3 Task 6 — `GET /schedule-runs`, `GET /schedule-runs/:id`,
 *                  `DELETE /schedule-runs/:id` route tests.
 *
 * Covers: happy path 202, idempotent replay (same key + body), 409 idempotency
 * conflict, 400 schema, 422 NO_ACTIVE_SEMESTER, 429 rate limit, 503
 * QUEUE_UNAVAILABLE, 401 unauth, audit row, and the read/delete endpoints
 * including owner-vs-admin filtering and the 409 ILLEGAL_STATE_TRANSITION
 * on RUNNING delete.
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

// ─── GET / DELETE (Phase 3 Task 6) ─────────────────────────────────────────

const adminBearer = () =>
  `Bearer ${signAccessToken({ id: 1, email: 'a@upj.ac.id', role: 'admin' })}`;

function seedAdmin(): void {
  fixture.insertUser({ id: 1, email: 'a@upj.ac.id', fullName: 'A', role: 'ADMIN' });
}

function seedRun(
  overrides: Partial<Parameters<CrudFixture['insertScheduleRun']>[0]>,
): ReturnType<CrudFixture['insertScheduleRun']> {
  return fixture.insertScheduleRun({
    id: 'run-x',
    semesterId: 1,
    createdById: 7,
    ...overrides,
  });
}

describe('GET /schedule-runs', () => {
  it('401 without bearer', async () => {
    const res = await request(app).get('/api/v1/schedule-runs');
    expect(res.status).toBe(401);
  });

  it('user only sees own runs (owner-vs-admin filter at repo)', async () => {
    seedUser();
    seedAdmin();
    seedRun({ id: 'run-mine', createdById: 7, status: 'COMPLETED' });
    seedRun({ id: 'run-other', createdById: 1, status: 'COMPLETED' });

    const res = await request(app)
      .get('/api/v1/schedule-runs')
      .set('Authorization', userBearer());

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(['run-mine']);
  });

  it('admin sees every run regardless of createdById', async () => {
    seedAdmin();
    seedRun({ id: 'run-1', createdById: 7, status: 'COMPLETED' });
    seedRun({ id: 'run-2', createdById: 1, status: 'COMPLETED' });

    const res = await request(app)
      .get('/api/v1/schedule-runs')
      .set('Authorization', adminBearer());

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
  });

  it('honours status / semesterId / pagination / sort filters', async () => {
    seedAdmin();
    seedRun({ id: 'r-q', createdById: 1, semesterId: 1, status: 'QUEUED', bestFitness: 0.1 });
    seedRun({ id: 'r-c1', createdById: 1, semesterId: 1, status: 'COMPLETED', bestFitness: 0.5 });
    seedRun({ id: 'r-c2', createdById: 1, semesterId: 2, status: 'COMPLETED', bestFitness: 0.9 });

    // status filter
    const byStatus = await request(app)
      .get('/api/v1/schedule-runs?status=COMPLETED')
      .set('Authorization', adminBearer());
    expect(byStatus.status).toBe(200);
    expect(byStatus.body.meta.total).toBe(2);

    // semesterId filter
    const bySem = await request(app)
      .get('/api/v1/schedule-runs?semesterId=2')
      .set('Authorization', adminBearer());
    expect(bySem.status).toBe(200);
    expect(bySem.body.meta.total).toBe(1);
    expect(bySem.body.data[0].id).toBe('r-c2');

    // sort by -bestFitness
    const sorted = await request(app)
      .get('/api/v1/schedule-runs?sort=-bestFitness')
      .set('Authorization', adminBearer());
    expect(sorted.status).toBe(200);
    const sortedIds = (sorted.body.data as Array<{ id: string }>).map((r) => r.id);
    expect(sortedIds).toEqual(['r-c2', 'r-c1', 'r-q']);
  });

  it('summary projection omits heavy JSON fields', async () => {
    seedAdmin();
    seedRun({
      id: 'run-heavy',
      createdById: 1,
      status: 'COMPLETED',
      configJson: '{"populationSize":50}',
      historyJson: '[0.1,0.2]',
      preGASummaryJson: '{"feasible":3,"infeasible":[]}',
    });
    const res = await request(app)
      .get('/api/v1/schedule-runs')
      .set('Authorization', adminBearer());
    expect(res.status).toBe(200);
    const row = res.body.data[0] as Record<string, unknown>;
    expect(row.id).toBe('run-heavy');
    expect(row.config).toBeUndefined();
    expect(row.history).toBeUndefined();
    expect(row.preGASummary).toBeUndefined();
  });
});

describe('GET /schedule-runs/:id', () => {
  it('401 without bearer', async () => {
    const res = await request(app).get('/api/v1/schedule-runs/run-x');
    expect(res.status).toBe(401);
  });

  it('200 — owner sees full detail incl. parsed JSON fields and assignments', async () => {
    seedUser();
    seedRun({
      id: 'run-detail',
      createdById: 7,
      status: 'COMPLETED',
      configJson: '{"populationSize":50,"generations":100}',
      preGASummaryJson: '{"feasible":3,"infeasible":[]}',
      ssaResultJson: '{"status":"FEASIBLE","totalSessionsRequired":3,"maximumAchievableMatching":3}',
      historyJson: '[0.1,0.5,0.9]',
      avgHistoryJson: '[0.05,0.4,0.8]',
      bestFitness: 0.9,
      hardViolations: 0,
      softPenalty: 5,
      generationsRun: 50,
      durationMs: 12345,
    });
    fixture.insertScheduleAssignment({
      id: 1,
      runId: 'run-detail',
      offeringId: 6,
      roomId: 3,
      sessionIndex: 0,
      isFixedRoom: true,
      lecturerIds: [5],
      slots: [{ id: 1, day: 'MONDAY', startTime: '08:00', endTime: '08:50' }],
      offering: {
        id: 6,
        courseCode: 'IF301',
        courseName: 'Rekayasa Perangkat Lunak',
        lecturers: [{ id: 5, name: 'Eko Prasetyo, M.Sc.' }],
      },
    });

    const res = await request(app)
      .get('/api/v1/schedule-runs/run-detail')
      .set('Authorization', userBearer());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('run-detail');
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.config).toEqual({ populationSize: 50, generations: 100 });
    expect(res.body.preGASummary).toEqual({ feasible: 3, infeasible: [] });
    expect(res.body.history).toEqual([0.1, 0.5, 0.9]);
    expect(res.body.avgHistory).toEqual([0.05, 0.4, 0.8]);
    expect(res.body.assignments).toHaveLength(1);
    expect(res.body.assignments[0]).toEqual(
      expect.objectContaining({
        offeringId: 6,
        offering: expect.objectContaining({ courseCode: 'IF301' }),
        sessions: [
          expect.objectContaining({
            assignmentId: 1,
            sessionIndex: 0,
            roomId: 3,
            isFixedRoom: true,
            lecturerIds: [5],
          }),
        ],
      }),
    );
  });

  it('200 — Phase 15 assignments include per-session lecturerIds and legacy rows surface []', async () => {
    seedUser();
    seedRun({
      id: 'run-phase15',
      createdById: 7,
      status: 'COMPLETED',
    });
    fixture.insertScheduleAssignment({
      id: 11,
      runId: 'run-phase15',
      offeringId: 6,
      roomId: 3,
      sessionIndex: 0,
      lecturerIds: [5],
      slots: [{ id: 1, day: 'MONDAY', startTime: '08:00', endTime: '08:50' }],
      offering: {
        id: 6,
        courseCode: 'IF301',
        courseName: 'Rekayasa Perangkat Lunak',
        lecturers: [
          { id: 5, name: 'Eko Prasetyo, M.Sc.' },
          { id: 9, name: 'Legacy Team Lecturer' },
        ],
      },
    });
    fixture.insertScheduleAssignment({
      id: 12,
      runId: 'run-phase15',
      offeringId: 7,
      roomId: 4,
      sessionIndex: 0,
      slots: [{ id: 2, day: 'TUESDAY', startTime: '09:00', endTime: '09:50' }],
      offering: {
        id: 7,
        courseCode: 'IF302',
        courseName: 'Basis Data',
        lecturers: [{ id: 9, name: 'Legacy Team Lecturer' }],
      },
    });

    const res = await request(app)
      .get('/api/v1/schedule-runs/run-phase15')
      .set('Authorization', userBearer());

    expect(res.status).toBe(200);
    const phase15 = res.body.assignments.find((a: { offeringId: number }) => a.offeringId === 6);
    const legacy = res.body.assignments.find((a: { offeringId: number }) => a.offeringId === 7);
    expect(phase15.sessions[0].lecturerIds).toEqual([5]);
    expect(legacy.sessions[0].lecturerIds).toEqual([]);
  });

  it('404 — `user` requesting another owner\'s run does NOT leak existence', async () => {
    seedUser();
    seedRun({ id: 'run-other', createdById: 99, status: 'COMPLETED' });

    const res = await request(app)
      .get('/api/v1/schedule-runs/run-other')
      .set('Authorization', userBearer());

    expect(res.status).toBe(404);
  });

  it('200 — admin can read any run', async () => {
    seedAdmin();
    seedRun({ id: 'run-other', createdById: 99, status: 'COMPLETED' });

    const res = await request(app)
      .get('/api/v1/schedule-runs/run-other')
      .set('Authorization', adminBearer());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('run-other');
  });

  it('404 when run does not exist', async () => {
    seedAdmin();
    const res = await request(app)
      .get('/api/v1/schedule-runs/run-missing')
      .set('Authorization', adminBearer());
    expect(res.status).toBe(404);
  });
});

describe('DELETE /schedule-runs/:id', () => {
  it('401 without bearer', async () => {
    const res = await request(app).delete('/api/v1/schedule-runs/run-x');
    expect(res.status).toBe(401);
  });

  it('204 — owner can hard-delete a COMPLETED run; row gone, audit recorded', async () => {
    seedUser();
    seedRun({ id: 'run-del', createdById: 7, status: 'COMPLETED' });

    const res = await request(app)
      .delete('/api/v1/schedule-runs/run-del')
      .set('Authorization', userBearer());

    expect(res.status).toBe(204);
    expect(fixture.scheduleRunStore.has('run-del')).toBe(false);
    const audit = fixture.auditLogStore.find((a) => a.action === 'schedule_run.delete');
    expect(audit).toBeDefined();
    expect(audit?.entityId).toBe('run-del');
    expect(JSON.parse(audit!.metadata!).status).toBe('COMPLETED');
  });

  it('204 — admin can delete any run', async () => {
    seedAdmin();
    seedRun({ id: 'run-other', createdById: 99, status: 'COMPLETED' });

    const res = await request(app)
      .delete('/api/v1/schedule-runs/run-other')
      .set('Authorization', adminBearer());
    expect(res.status).toBe(204);
    expect(fixture.scheduleRunStore.has('run-other')).toBe(false);
  });

  it('409 ILLEGAL_STATE_TRANSITION when status === RUNNING', async () => {
    seedAdmin();
    seedRun({ id: 'run-running', createdById: 1, status: 'RUNNING' });

    const res = await request(app)
      .delete('/api/v1/schedule-runs/run-running')
      .set('Authorization', adminBearer());

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('ILLEGAL_STATE_TRANSITION');
    expect(fixture.scheduleRunStore.has('run-running')).toBe(true);
  });

  it('404 — `user` deleting another owner\'s run does NOT leak existence', async () => {
    seedUser();
    seedRun({ id: 'run-other', createdById: 99, status: 'COMPLETED' });

    const res = await request(app)
      .delete('/api/v1/schedule-runs/run-other')
      .set('Authorization', userBearer());

    expect(res.status).toBe(404);
    // Untouched: the row still exists.
    expect(fixture.scheduleRunStore.has('run-other')).toBe(true);
  });

  it('404 when run does not exist', async () => {
    seedAdmin();
    const res = await request(app)
      .delete('/api/v1/schedule-runs/missing')
      .set('Authorization', adminBearer());
    expect(res.status).toBe(404);
  });
});
