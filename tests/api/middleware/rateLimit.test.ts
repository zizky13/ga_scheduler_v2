process.env.LOG_LEVEL = 'silent';

import { describe, expect, it } from 'vitest';
import express, { type Application, type RequestHandler } from 'express';
import request from 'supertest';

import {
  InMemoryWindowStore,
  rateLimitAuth,
  rateLimitRun,
} from '../../../src/api/middleware/rateLimit';
import { errorHandler } from '../../../src/api/middleware/errorHandler';
import type { AccessTokenClaims, AuthRole } from '../../../src/api/lib/auth';

function injectUser(claims: AccessTokenClaims | undefined): RequestHandler {
  return (req, _res, next) => {
    if (claims) req.user = claims;
    next();
  };
}

function makeClock(start = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const userClaims = (role: AuthRole, id = 7): AccessTokenClaims => ({
  id,
  role,
  email: `${role}@example.com`,
});

describe('InMemoryWindowStore', () => {
  it('allows up to max attempts then denies, with retry-after rounded up', () => {
    const store = new InMemoryWindowStore();
    const windowMs = 60_000;
    const max = 3;
    const t0 = 1_000_000;

    expect(store.hit('k', t0, windowMs, max).allowed).toBe(true);
    expect(store.hit('k', t0 + 10, windowMs, max).allowed).toBe(true);
    expect(store.hit('k', t0 + 20, windowMs, max).allowed).toBe(true);

    const denied = store.hit('k', t0 + 30, windowMs, max);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBe(60); // oldest hit at t0 expires at t0+60s
  });

  it('frees a slot once the oldest hit ages out', () => {
    const store = new InMemoryWindowStore();
    const windowMs = 60_000;
    const t0 = 1_000_000;

    store.hit('k', t0, windowMs, 2);
    store.hit('k', t0 + 1_000, windowMs, 2);
    expect(store.hit('k', t0 + 2_000, windowMs, 2).allowed).toBe(false);

    // Advance past the first hit's expiry.
    expect(store.hit('k', t0 + 60_001, windowMs, 2).allowed).toBe(true);
  });

  it('keeps separate buckets per key', () => {
    const store = new InMemoryWindowStore();
    const windowMs = 60_000;
    const t = 1_000_000;
    expect(store.hit('a', t, windowMs, 1).allowed).toBe(true);
    expect(store.hit('a', t, windowMs, 1).allowed).toBe(false);
    expect(store.hit('b', t, windowMs, 1).allowed).toBe(true);
  });
});

function buildAuthApp(now: () => number, store: InMemoryWindowStore): Application {
  const app = express();
  app.use(express.json());
  app.post(
    '/login',
    rateLimitAuth({ max: 3, windowMs: 60_000, store, now }),
    (_req, res) => res.status(200).json({ ok: true }),
  );
  app.use(errorHandler());
  return app;
}

describe('rateLimitAuth', () => {
  it('allows the first N requests then 429s with Retry-After', async () => {
    const clock = makeClock();
    const store = new InMemoryWindowStore();
    const app = buildAuthApp(clock.now, store);

    for (let i = 0; i < 3; i += 1) {
      const ok = await request(app).post('/login').send({});
      expect(ok.status).toBe(200);
    }

    const limited = await request(app).post('/login').send({});
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.body.error.details?.retryAfterSec).toBeGreaterThan(0);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('resets after the window elapses', async () => {
    const clock = makeClock();
    const store = new InMemoryWindowStore();
    const app = buildAuthApp(clock.now, store);

    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/login').send({});
    }
    const limited = await request(app).post('/login').send({});
    expect(limited.status).toBe(429);

    clock.advance(60_001);
    const ok = await request(app).post('/login').send({});
    expect(ok.status).toBe(200);
  });
});

function buildRunApp(
  now: () => number,
  store: InMemoryWindowStore,
  claims: AccessTokenClaims | undefined,
): Application {
  const app = express();
  app.use(express.json());
  app.post(
    '/run',
    injectUser(claims),
    rateLimitRun({ max: 5, windowMs: 5 * 60_000, store, now }),
    (_req, res) => res.status(202).json({ ok: true }),
  );
  app.use(errorHandler());
  return app;
}

describe('rateLimitRun', () => {
  it('counts per req.user.id and 429s on the 6th attempt', async () => {
    const clock = makeClock();
    const store = new InMemoryWindowStore();
    const app = buildRunApp(clock.now, store, userClaims('user', 7));

    for (let i = 0; i < 5; i += 1) {
      const ok = await request(app).post('/run').send({});
      expect(ok.status).toBe(202);
    }
    const limited = await request(app).post('/run').send({});
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('different users do not share a bucket', async () => {
    const clock = makeClock();
    const store = new InMemoryWindowStore();
    const appA = buildRunApp(clock.now, store, userClaims('user', 7));
    const appB = buildRunApp(clock.now, store, userClaims('user', 8));

    for (let i = 0; i < 5; i += 1) {
      await request(appA).post('/run').send({});
    }
    expect((await request(appA).post('/run').send({})).status).toBe(429);
    expect((await request(appB).post('/run').send({})).status).toBe(202);
  });

  it('resets after the window elapses', async () => {
    const clock = makeClock();
    const store = new InMemoryWindowStore();
    const app = buildRunApp(clock.now, store, userClaims('user', 7));

    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/run').send({});
    }
    expect((await request(app).post('/run').send({})).status).toBe(429);

    clock.advance(5 * 60_000 + 1);
    expect((await request(app).post('/run').send({})).status).toBe(202);
  });

  it('returns 401 when req.user is missing (defensive: must run after requireAuth)', async () => {
    const clock = makeClock();
    const store = new InMemoryWindowStore();
    const app = buildRunApp(clock.now, store, undefined);
    const res = await request(app).post('/run').send({});
    expect(res.status).toBe(401);
  });
});
