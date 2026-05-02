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

  it('returns 501 NOT_IMPLEMENTED when POST /auth/login is sent a valid body', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'someone@upj.ac.id', password: 'long-enough-password' });
    expect(res.status).toBe(501);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: expect.stringContaining('POST /auth/login'),
      },
    });
  });

  it('returns 400 when POST /lecturers omits required fields', async () => {
    const res = await request(app).post('/api/v1/lecturers').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 501 when POST /lecturers is given a valid body', async () => {
    const res = await request(app)
      .post('/api/v1/lecturers')
      .send({ semesterId: 1, name: 'Dr. Ani', competencies: ['algorithms'] });
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('returns 400 when POST /schedule-runs config violates the elitism invariant', async () => {
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
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 when GET /lecturers/:id receives a non-numeric id', async () => {
    const res = await request(app).get('/api/v1/lecturers/not-a-number');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 501 when GET /lecturers/:id is well-formed', async () => {
    const res = await request(app).get('/api/v1/lecturers/42');
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});
