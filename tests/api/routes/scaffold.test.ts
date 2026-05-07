process.env.LOG_LEVEL = 'silent';

import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { createServer } from '../../../src/api/server';

let app: Application;

beforeAll(() => {
  app = createServer();
});

describe('Phase 2 Task 2 — route scaffolding', () => {
  it('returns 400 VALIDATION_FAILED when POST /auth/login is sent an empty body', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(res.body.error.details?.issues)).toBe(true);
  });

  // POST /auth/login is no longer NOT_IMPLEMENTED — Phase 2 Task 3 wired the
  // real handler. Behavioural coverage now lives in tests/api/routes/auth.test.ts.

  it('returns 401 when POST /lecturers is unauthenticated (auth runs before validation)', async () => {
    const res = await request(app).post('/api/v1/lecturers').send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  // POST /lecturers is no longer NOT_IMPLEMENTED — Phase 2 Task 6 wired the
  // real handler. Behavioural coverage lives in tests/api/routes/lecturers.test.ts.

  it('returns 401 when POST /schedule-runs is unauthenticated (auth runs before validation)', async () => {
    // Phase 3 Task 5 wired requireAuth() / rateLimitRun() in front of the
    // body validator, so this request never reaches Zod. Behavioural
    // coverage of the elitism invariant lives in
    // tests/api/routes/schedule-runs.test.ts.
    const res = await request(app)
      .post('/api/v1/schedule-runs')
      .send({
        semesterId: 1,
        config: {
          populationSize: 10,
          generations: 100,
          mutationRate: 0.05,
          elitismCount: 50,
          tournamentSize: 4,
          crossoverType: 'uniform',
          noiseRate: 0.1,
        },
      });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when GET /lecturers/:id receives a non-numeric id (auth runs before validation)', async () => {
    const res = await request(app).get('/api/v1/lecturers/not-a-number');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  // GET /lecturers/:id is no longer NOT_IMPLEMENTED — Phase 2 Task 6 wired the
  // real handler. Behavioural coverage lives in tests/api/routes/lecturers.test.ts.
});
