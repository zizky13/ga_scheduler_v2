// Quiet pino during tests; must be set before importing the server module so
// the root logger picks up the silent level at construction time. The error
// handler still receives req.log and exercises the same code paths.
process.env.LOG_LEVEL = 'silent';

import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { createServer } from '../../src/api/server';
import {
  AuthError,
  AuthzError,
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationError,
} from '../../src/api/errors';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let app: Application;

beforeAll(() => {
  app = createServer({
    beforeErrorHandler: (instance) => {
      instance.get('/__throw/validation', (_req, _res, next) => {
        next(
          new ValidationError('bad body', [
            { path: ['email'], message: 'invalid email', code: 'invalid_string' },
          ]),
        );
      });
      instance.get('/__throw/auth', (_req, _res, next) => {
        next(new AuthError('INVALID_CREDENTIALS', 'Invalid credentials'));
      });
      instance.get('/__throw/authz', (_req, _res, next) => {
        next(new AuthzError());
      });
      instance.get('/__throw/not-found', (_req, _res, next) => {
        next(new NotFoundError('User missing'));
      });
      instance.get('/__throw/conflict', (_req, _res, next) => {
        next(new ConflictError('IDEMPOTENCY_CONFLICT', 'Duplicate idempotency key'));
      });
      instance.get('/__throw/domain', (_req, _res, next) => {
        next(new DomainError('SSA_INFEASIBLE', 'SSA reported infeasible domain'));
      });
      instance.get('/__throw/unknown', (_req, _res, next) => {
        next(new Error('boom: secret stack should not leak'));
      });
    },
  });
});

describe('GET /api/v1/health', () => {
  it('returns the documented body, 200, and an X-Request-Id header', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      uptimeSec: expect.any(Number),
    });
    expect(res.body.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(res.headers['x-request-id']).toMatch(UUID_V4);
  });
});

describe('X-Request-Id propagation', () => {
  it('echoes a sane client-supplied request id', async () => {
    const id = 'my-trace-123';
    const res = await request(app).get('/api/v1/health').set('X-Request-Id', id);
    expect(res.headers['x-request-id']).toBe(id);
  });

  it('generates a fresh UUID when no client id is supplied', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-request-id']).toMatch(UUID_V4);
  });

  it('replaces an over-long client id with a fresh UUID', async () => {
    const tooLong = 'a'.repeat(200);
    const res = await request(app).get('/api/v1/health').set('X-Request-Id', tooLong);
    expect(res.headers['x-request-id']).not.toBe(tooLong);
    expect(res.headers['x-request-id']).toMatch(UUID_V4);
  });

  it('replaces an id with invalid characters with a fresh UUID', async () => {
    const malformed = 'has spaces and !@# weird chars';
    const res = await request(app).get('/api/v1/health').set('X-Request-Id', malformed);
    expect(res.headers['x-request-id']).not.toBe(malformed);
    expect(res.headers['x-request-id']).toMatch(UUID_V4);
  });
});

describe('Centralized error handler', () => {
  it('maps ValidationError to 400 with issue list', async () => {
    const res = await request(app).get('/__throw/validation');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'bad body',
        details: {
          issues: [{ path: ['email'], message: 'invalid email', code: 'invalid_string' }],
        },
      },
    });
  });

  it('maps AuthError to 401 with the concrete code', async () => {
    const res = await request(app).get('/__throw/auth');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
    });
  });

  it('maps AuthzError to 403', async () => {
    const res = await request(app).get('/__throw/authz');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('maps NotFoundError to 404', async () => {
    const res = await request(app).get('/__throw/not-found');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('maps ConflictError to 409 with the concrete code', async () => {
    const res = await request(app).get('/__throw/conflict');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('maps DomainError to 422 with the supplied code', async () => {
    const res = await request(app).get('/__throw/domain');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SSA_INFEASIBLE');
  });

  it('maps unknown errors to 500 INTERNAL_ERROR without leaking the stack', async () => {
    const res = await request(app).get('/__throw/unknown');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('secret stack');
    expect(serialized).not.toContain('boom');
    expect(serialized).not.toContain('at ');
  });
});

describe('404 fallthrough', () => {
  it('returns the error envelope with code NOT_FOUND', async () => {
    const res = await request(app).get('/api/v1/this-route-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.headers['x-request-id']).toBeDefined();
  });
});
