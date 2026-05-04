/**
 * Phase 2 Task 8 — `AuditLog` write tests.
 *
 * Verifies that every state-changing route emits one `AuditLog` row per the
 * api_design §8 action table, with `before`/`after` diffs, request-id
 * propagation, and redacted password hashes. Also verifies the helper's
 * "audit failure must not surface to caller" contract.
 *
 * Strategy mirrors the other route tests: install the in-memory CRUD repo
 * fixture (which now includes a fake `auditLogRepo`) so the real route
 * handlers + middleware run end-to-end without Prisma.
 */

process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

import { createServer } from '../../../src/api/server';
import { setCrudRepositoriesForTests } from '../../../src/api/lib/crudContext';
import {
  setAuthRepositoriesForTests,
  type AuthRepositories,
} from '../../../src/api/lib/authContext';
import { hashPassword, signAccessToken } from '../../../src/api/lib/auth';
import { buildCrudFixture, type CrudFixture } from './_crudFixture';
import type { RefreshTokenRepository, RefreshTokenRecord } from '../../../src/repo/refreshTokenRepo';

let app: Application;
let fixture: CrudFixture;

beforeAll(() => {
  app = createServer();
});

beforeEach(() => {
  fixture = buildCrudFixture();
  setCrudRepositoriesForTests(fixture.repos);
  // The auth route module reads via `getAuthRepositories()`, separate from
  // the CRUD seam. Wire a thin auth context that points at the same user
  // store + a stub refresh-token repo so login/logout can run.
  const refreshStore = new Map<string, RefreshTokenRecord>();
  let nextRefreshId = 1;
  const refreshTokens: RefreshTokenRepository = {
    async createRefreshToken(input) {
      const id = `rt_${nextRefreshId++}`;
      const row: RefreshTokenRecord = {
        id,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        revokedAt: null,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        createdAt: new Date(),
      };
      refreshStore.set(id, row);
      return row;
    },
    async findActiveByHash(tokenHash, now = new Date()) {
      for (const row of refreshStore.values()) {
        if (row.tokenHash !== tokenHash) continue;
        if (row.revokedAt !== null) return null;
        if (row.expiresAt.getTime() <= now.getTime()) return null;
        return row;
      }
      return null;
    },
    async revokeById(id, when = new Date()) {
      const row = refreshStore.get(id);
      if (row) row.revokedAt = when;
    },
    async revokeAllForUser(userId, when = new Date()) {
      let count = 0;
      for (const row of refreshStore.values()) {
        if (row.userId === userId && row.revokedAt === null) {
          row.revokedAt = when;
          count++;
        }
      }
      return count;
    },
  };
  const auth: AuthRepositories = {
    users: fixture.repos.users,
    refreshTokens,
  };
  setAuthRepositoriesForTests(auth);
});

afterAll(() => {
  setCrudRepositoriesForTests(undefined);
  setAuthRepositoriesForTests(undefined);
});

const adminBearer = () =>
  `Bearer ${signAccessToken({ id: 1, email: 'a@upj.ac.id', role: 'admin' })}`;
const userBearer = () =>
  `Bearer ${signAccessToken({ id: 7, email: 'u@upj.ac.id', role: 'user' })}`;

function seedAdmin(): void {
  fixture.insertUser({ id: 1, email: 'a@upj.ac.id', fullName: 'A', role: 'ADMIN' });
}
function seedUser(): void {
  fixture.insertUser({ id: 7, email: 'u@upj.ac.id', fullName: 'U', role: 'USER' });
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('audit: lecturer.create', () => {
  it('writes one row with role, requestId matching X-Request-Id, actorId=user', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });

    const res = await request(app)
      .post('/api/v1/lecturers')
      .set('Authorization', userBearer())
      .send({
        semesterId: sem.id,
        name: 'Dr. Alpha',
        preferredTimeSlotIds: [],
        competencies: ['ai-ml'],
      });
    expect(res.status).toBe(201);
    const xRequestId = res.headers['x-request-id'];
    expect(typeof xRequestId).toBe('string');

    expect(fixture.auditLogStore).toHaveLength(1);
    const row = fixture.auditLogStore[0]!;
    expect(row.action).toBe('lecturer.create');
    expect(row.entityType).toBe('Lecturer');
    expect(row.entityId).toBe(String(res.body.id));
    expect(row.actorId).toBe(7);

    const metadata = parseMetadata(row.metadata);
    expect(metadata.role).toBe('user');
    expect(metadata.before).toBeNull();
    expect(metadata.requestId).toBe(xRequestId);
    expect(metadata.after).toEqual(
      expect.objectContaining({ name: 'Dr. Alpha', competencies: ['ai-ml'] }),
    );
  });
});

describe('audit: user.update redacts passwordHash', () => {
  it('passwordHash on before and after is [REDACTED]', async () => {
    seedAdmin();
    const target = fixture.insertUser({
      email: 't@upj.ac.id',
      fullName: 'Target',
      passwordHash: 'super-secret-hash-do-not-leak',
      role: 'USER',
    });

    const res = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set('Authorization', adminBearer())
      .send({ fullName: 'New Name' });
    expect(res.status).toBe(200);

    expect(fixture.auditLogStore).toHaveLength(1);
    const row = fixture.auditLogStore[0]!;
    expect(row.action).toBe('user.update');
    expect(row.entityType).toBe('User');
    expect(row.entityId).toBe(String(target.id));

    const metadata = parseMetadata(row.metadata);
    const before = metadata.before as Record<string, unknown>;
    const after = metadata.after as Record<string, unknown>;
    expect(before.passwordHash).toBe('[REDACTED]');
    expect(after.passwordHash).toBe('[REDACTED]');
    // Spot-check that other fields actually carried through.
    expect(after.fullName).toBe('New Name');
    expect(before.fullName).toBe('Target');
  });
});

describe('audit: room.delete', () => {
  it('writes row with action=room.delete and metadata.after=null', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const room = fixture.insertRoom({ semesterId: sem.id, name: 'R-101', capacity: 30 });

    const res = await request(app)
      .delete(`/api/v1/rooms/${room.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(204);

    expect(fixture.auditLogStore).toHaveLength(1);
    const row = fixture.auditLogStore[0]!;
    expect(row.action).toBe('room.delete');
    expect(row.entityType).toBe('Room');
    expect(row.entityId).toBe(String(room.id));

    const metadata = parseMetadata(row.metadata);
    expect(metadata.after).toBeNull();
    expect(metadata.before).toEqual(expect.objectContaining({ name: 'R-101', capacity: 30 }));
  });
});

describe('audit: auth.login_failed', () => {
  it('writes row with actorId=null and metadata.success=false on bad password', async () => {
    const passwordHash = await hashPassword('correct-horse-1');
    fixture.insertUser({
      email: 'jane@upj.ac.id',
      fullName: 'Jane',
      passwordHash,
      role: 'USER',
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'jane@upj.ac.id', password: 'wrong-password-9' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');

    expect(fixture.auditLogStore).toHaveLength(1);
    const row = fixture.auditLogStore[0]!;
    expect(row.action).toBe('auth.login_failed');
    expect(row.actorId).toBeNull();

    const metadata = parseMetadata(row.metadata);
    expect(metadata.success).toBe(false);
    expect(metadata.email).toBe('jane@upj.ac.id');
  });

  it('writes row with actorId=null when email does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@upj.ac.id', password: 'whatever-1234' });
    expect(res.status).toBe(401);

    expect(fixture.auditLogStore).toHaveLength(1);
    const row = fixture.auditLogStore[0]!;
    expect(row.action).toBe('auth.login_failed');
    expect(row.actorId).toBeNull();
  });
});

describe('audit: auth.login success', () => {
  it('writes row with actorId=<user.id> and metadata.email set', async () => {
    const passwordHash = await hashPassword('good-pass-99');
    const u = fixture.insertUser({
      email: 'jane@upj.ac.id',
      fullName: 'Jane',
      passwordHash,
      role: 'USER',
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'jane@upj.ac.id', password: 'good-pass-99' });
    expect(res.status).toBe(200);

    expect(fixture.auditLogStore).toHaveLength(1);
    const row = fixture.auditLogStore[0]!;
    expect(row.action).toBe('auth.login');
    expect(row.actorId).toBe(u.id);

    const metadata = parseMetadata(row.metadata);
    expect(metadata.email).toBe('jane@upj.ac.id');
    expect(metadata.success).toBe(true);
  });
});

describe('audit: failure does not break the request', () => {
  it('returns 201 even when audit-repo create() throws', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    fixture.auditLogFail.active = true;

    const res = await request(app)
      .post('/api/v1/lecturers')
      .set('Authorization', userBearer())
      .send({
        semesterId: sem.id,
        name: 'Dr. Beta',
        preferredTimeSlotIds: [],
        competencies: [],
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Dr. Beta');
    // Audit row was never persisted because the fake threw.
    expect(fixture.auditLogStore).toHaveLength(0);
  });
});
