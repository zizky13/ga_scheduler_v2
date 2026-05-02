process.env.LOG_LEVEL = 'silent';

import { describe, expect, it, vi } from 'vitest';
import express, { type Application, type Request, type RequestHandler } from 'express';
import request from 'supertest';

import {
  allowFields,
  requireOwnerOrAdmin,
} from '../../../src/api/middleware/permissions';
import { errorHandler } from '../../../src/api/middleware/errorHandler';
import type { AccessTokenClaims, AuthRole } from '../../../src/api/lib/auth';

function injectUser(claims: AccessTokenClaims | undefined): RequestHandler {
  return (req, _res, next) => {
    if (claims) req.user = claims;
    next();
  };
}

function buildHarness(...layers: RequestHandler[]): Application {
  const app = express();
  app.use(express.json());
  app.post('/probe', ...layers, (req, res) => {
    res.status(200).json({ ok: true, body: req.body, user: req.user ?? null });
  });
  app.get('/probe', ...layers, (req, res) => {
    res.status(200).json({ ok: true, user: req.user ?? null });
  });
  app.use(errorHandler());
  return app;
}

const userClaims = (role: AuthRole, id = 7): AccessTokenClaims => ({
  id,
  role,
  email: `${role}@example.com`,
});

describe('requireOwnerOrAdmin', () => {
  it('admin short-circuits without invoking the loader', async () => {
    const loader = vi.fn();
    const app = buildHarness(injectUser(userClaims('admin')), requireOwnerOrAdmin(loader));
    const res = await request(app).get('/probe');
    expect(res.status).toBe(200);
    expect(loader).not.toHaveBeenCalled();
  });

  it('owner is allowed through', async () => {
    const loader = vi.fn(async (_req: Request) => ({ createdById: 7 }));
    const app = buildHarness(injectUser(userClaims('user', 7)), requireOwnerOrAdmin(loader));
    const res = await request(app).get('/probe');
    expect(res.status).toBe(200);
    expect(loader).toHaveBeenCalledOnce();
  });

  it('non-owner returns 404 (not 403, to avoid resource enumeration)', async () => {
    const loader = vi.fn(async (_req: Request) => ({ createdById: 99 }));
    const app = buildHarness(injectUser(userClaims('user', 7)), requireOwnerOrAdmin(loader));
    const res = await request(app).get('/probe');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('missing resource returns 404', async () => {
    const loader = vi.fn(async () => null);
    const app = buildHarness(injectUser(userClaims('user', 7)), requireOwnerOrAdmin(loader));
    const res = await request(app).get('/probe');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('loader errors bubble through next(err) → 500', async () => {
    const loader = vi.fn(async () => {
      throw new Error('db down');
    });
    const app = buildHarness(injectUser(userClaims('user', 7)), requireOwnerOrAdmin(loader));
    const res = await request(app).get('/probe');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 401 when called without an authenticated user', async () => {
    const loader = vi.fn();
    const app = buildHarness(injectUser(undefined), requireOwnerOrAdmin(loader));
    const res = await request(app).get('/probe');
    expect(res.status).toBe(401);
    expect(loader).not.toHaveBeenCalled();
  });
});

describe('allowFields', () => {
  const ALLOW = ['name', 'preferredTimeSlotIds', 'competencies'];

  it('admin passes through with extra fields untouched', async () => {
    const app = buildHarness(injectUser(userClaims('admin')), allowFields(ALLOW));
    const res = await request(app)
      .post('/probe')
      .send({ name: 'A', isStructural: true, semesterId: 9 });
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ name: 'A', isStructural: true, semesterId: 9 });
  });

  it('user with allowed-only fields passes through', async () => {
    const app = buildHarness(injectUser(userClaims('user')), allowFields(ALLOW));
    const res = await request(app)
      .post('/probe')
      .send({ name: 'A', preferredTimeSlotIds: [1, 2] });
    expect(res.status).toBe(200);
  });

  it('user with disallowed field gets 400 FIELD_NOT_ALLOWED listing offending keys', async () => {
    const app = buildHarness(injectUser(userClaims('user')), allowFields(ALLOW));
    const res = await request(app)
      .post('/probe')
      .send({ name: 'A', isStructural: true, semesterId: 9 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FIELD_NOT_ALLOWED');
    const issues = res.body.error.details?.issues ?? [];
    const fields = issues.map((i: { path: (string | number)[] }) => i.path[0]);
    expect(fields.sort()).toEqual(['isStructural', 'semesterId']);
  });

  it('non-object body is left to downstream Zod validation', async () => {
    const app = buildHarness(injectUser(userClaims('user')), allowFields(ALLOW));
    // Express parses an empty body to `{}`; sending a JSON array still parses
    // to an array, which `allowFields` should ignore.
    const res = await request(app)
      .post('/probe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(['nope']));
    expect(res.status).toBe(200);
  });
});
