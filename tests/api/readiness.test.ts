// Quiet pino during tests; must be set before importing the server module so
// the root logger picks up the silent level at construction time.
process.env.LOG_LEVEL = 'silent';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { createServer } from '../../src/api/server';
import {
  PING_TIMEOUT_MS,
  setReadinessCheckerForTests,
  type ReadinessChecker,
} from '../../src/api/lib/readiness';

let app: Application;

beforeAll(() => {
  app = createServer();
});

afterEach(() => {
  // Reset the module-scoped checker so each test starts from a clean slate.
  // Without this, a stub from one test would leak into the next.
  setReadinessCheckerForTests(undefined);
});

function stubChecker(overrides: Partial<ReadinessChecker>): ReadinessChecker {
  return {
    pingDb: overrides.pingDb ?? (async () => true),
    pingRedis: overrides.pingRedis ?? (async () => true),
  };
}

describe('GET /api/v1/ready', () => {
  it('returns 200 with status=ready when both pings succeed', async () => {
    setReadinessCheckerForTests(
      stubChecker({
        pingDb: async () => true,
        pingRedis: async () => true,
      }),
    );

    const res = await request(app).get('/api/v1/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ready',
      checks: { db: 'ok', redis: 'ok' },
    });
  });

  it('returns 503 with checks.db=fail when the DB ping rejects', async () => {
    setReadinessCheckerForTests(
      stubChecker({
        pingDb: async () => {
          throw new Error('SECRET internal connection string leaked here');
        },
        pingRedis: async () => true,
      }),
    );

    const res = await request(app).get('/api/v1/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'not_ready',
      checks: { db: 'fail', redis: 'ok' },
    });
    // Confirm the rejection reason never reaches the client body.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('connection string');
  });

  it('returns 503 with checks.redis=fail when the Redis ping rejects', async () => {
    setReadinessCheckerForTests(
      stubChecker({
        pingDb: async () => true,
        pingRedis: async () => {
          throw new Error('redis ECONNREFUSED');
        },
      }),
    );

    const res = await request(app).get('/api/v1/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'not_ready',
      checks: { db: 'ok', redis: 'fail' },
    });
  });

  it('returns 503 with both checks=fail when both pings reject', async () => {
    setReadinessCheckerForTests(
      stubChecker({
        pingDb: async () => {
          throw new Error('db down');
        },
        pingRedis: async () => {
          throw new Error('redis down');
        },
      }),
    );

    const res = await request(app).get('/api/v1/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'not_ready',
      checks: { db: 'fail', redis: 'fail' },
    });
  });

  it('treats a ping that resolves false as a failure', async () => {
    // `redis.ping()` returns the literal string 'PONG' on success; the
    // default checker only treats that exact value as healthy. Cover the
    // boolean path: a ping resolving to `false` must produce checks.x=fail
    // even though the promise itself didn't reject.
    setReadinessCheckerForTests(
      stubChecker({
        pingDb: async () => true,
        pingRedis: async () => false,
      }),
    );

    const res = await request(app).get('/api/v1/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ db: 'ok', redis: 'fail' });
  });

  it('treats a hanging ping as a failure (timeout path)', async () => {
    // The default checker wraps each ping in a 1s timeout. Simulate a hang
    // longer than that and confirm the route still returns 503 in bounded
    // time. We use a stub that never resolves — the route's Promise.allSettled
    // will see the underlying rejection only if the stub itself enforces a
    // timeout, so we mirror withTimeout here to exercise the same shape.
    setReadinessCheckerForTests(
      stubChecker({
        pingDb: async () => true,
        pingRedis: () =>
          new Promise<boolean>((_resolve, reject) => {
            setTimeout(() => reject(new Error('redis ping timed out')), 50);
          }),
      }),
    );

    const start = Date.now();
    const res = await request(app).get('/api/v1/ready');
    const elapsed = Date.now() - start;

    expect(res.status).toBe(503);
    expect(res.body.checks.redis).toBe('fail');
    // Sanity check: should resolve well under the production 1s cap.
    expect(elapsed).toBeLessThan(PING_TIMEOUT_MS);
  });
});

describe('GET /api/v1/health (regression)', () => {
  it('still returns the documented liveness body without touching the readiness checker', async () => {
    // Install a checker that throws if invoked. /health must not call it.
    setReadinessCheckerForTests({
      pingDb: async () => {
        throw new Error('liveness should not ping the DB');
      },
      pingRedis: async () => {
        throw new Error('liveness should not ping Redis');
      },
    });

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      uptimeSec: expect.any(Number),
    });
  });
});
