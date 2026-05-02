/**
 * Phase 2 Task 3 — auth route tests.
 *
 * Strategy: rather than spin up a Prisma test harness for this slice (we don't
 * have one yet), we install in-memory `UserRepository` / `RefreshTokenRepository`
 * fakes via the DI seam in `src/api/lib/authContext.ts`. This exercises the
 * real route handlers, real middleware, real JWT/bcrypt/refresh-token logic —
 * only the persistence boundary is faked. A future integration suite (tracked
 * in backlog Phase 5 §1) should re-run these flows against a sandbox Postgres.
 */

process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import type { Role } from '@prisma/client';

import { createServer } from '../../../src/api/server';
import {
  setAuthRepositoriesForTests,
  type AuthRepositories,
} from '../../../src/api/lib/authContext';
import type {
  CreateUserInput,
  UserRepository,
  UserRecord,
} from '../../../src/repo/userRepo';
import type {
  CreateRefreshTokenInput,
  RefreshTokenRepository,
  RefreshTokenRecord,
} from '../../../src/repo/refreshTokenRepo';
import {
  hashPassword,
  signAccessToken,
} from '../../../src/api/lib/auth';

// ─── In-memory fakes ───────────────────────────────────────────────────────

interface InMemoryFixture {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  // Direct handles for assertions.
  userStore: Map<number, UserRecord>;
  refreshStore: Map<string, RefreshTokenRecord>;
  // Test helpers.
  insertUser: (u: Partial<UserRecord> & {
    email: string;
    passwordHash: string;
    fullName: string;
  }) => UserRecord;
  triggerUniqueViolation: { active: boolean };
}

function buildInMemoryRepos(): InMemoryFixture {
  const userStore = new Map<number, UserRecord>();
  const refreshStore = new Map<string, RefreshTokenRecord>();
  let nextUserId = 1;
  let nextRefreshId = 1;
  const triggerUniqueViolation = { active: false };

  const users: UserRepository = {
    async findUserByEmail(email) {
      for (const u of userStore.values()) {
        if (u.email === email) return clone(u);
      }
      return null;
    },
    async findUserById(id) {
      const u = userStore.get(id);
      return u ? clone(u) : null;
    },
    async createUser(input: CreateUserInput) {
      if (triggerUniqueViolation.active) {
        triggerUniqueViolation.active = false;
        const err = new Error('Unique constraint failed') as Error & { code?: string };
        err.code = 'P2002';
        throw err;
      }
      for (const u of userStore.values()) {
        if (u.email === input.email) {
          const err = new Error('Unique constraint failed') as Error & { code?: string };
          err.code = 'P2002';
          throw err;
        }
      }
      const now = new Date();
      const id = nextUserId++;
      const row: UserRecord = {
        id,
        email: input.email,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        role: input.role,
        isActive: true,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      };
      userStore.set(id, row);
      return clone(row);
    },
    async updateLastLogin(id, when) {
      const u = userStore.get(id);
      if (!u) return;
      u.lastLoginAt = when;
      u.updatedAt = new Date();
    },
    async setActive(id, isActive) {
      const u = userStore.get(id);
      if (!u) throw new Error(`user ${id} not found`);
      u.isActive = isActive;
      u.updatedAt = new Date();
      return clone(u);
    },
  };

  const refreshTokens: RefreshTokenRepository = {
    async createRefreshToken(input: CreateRefreshTokenInput) {
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
      return clone(row);
    },
    async findActiveByHash(tokenHash, now = new Date()) {
      for (const row of refreshStore.values()) {
        if (row.tokenHash !== tokenHash) continue;
        if (row.revokedAt !== null) return null;
        if (row.expiresAt.getTime() <= now.getTime()) return null;
        return clone(row);
      }
      return null;
    },
    async revokeById(id, when = new Date()) {
      const row = refreshStore.get(id);
      if (!row) return;
      row.revokedAt = when;
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

  function insertUser(u: Partial<UserRecord> & {
    email: string;
    passwordHash: string;
    fullName: string;
  }): UserRecord {
    const now = new Date();
    const id = u.id ?? nextUserId++;
    const row: UserRecord = {
      id,
      email: u.email,
      passwordHash: u.passwordHash,
      fullName: u.fullName,
      role: (u.role ?? 'USER') as Role,
      isActive: u.isActive ?? true,
      lastLoginAt: u.lastLoginAt ?? null,
      createdAt: u.createdAt ?? now,
      updatedAt: u.updatedAt ?? now,
    };
    userStore.set(id, row);
    return clone(row);
  }

  return {
    users,
    refreshTokens,
    userStore,
    refreshStore,
    insertUser,
    triggerUniqueViolation,
  };
}

function clone<T>(v: T): T {
  // Mirror Prisma's behaviour of returning fresh objects each call.
  return JSON.parse(JSON.stringify(v, (_, x) => (x instanceof Date ? x.toISOString() : x)),
    (_, x) => {
      if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x)) {
        const d = new Date(x);
        return Number.isNaN(d.getTime()) ? x : d;
      }
      return x;
    },
  ) as T;
}

// ─── Test scaffolding ──────────────────────────────────────────────────────

let app: Application;
let fixture: InMemoryFixture;

function getRefreshCookie(setCookieHeader: string | string[] | undefined): string | null {
  if (!setCookieHeader) return null;
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const c of arr) {
    if (c.startsWith('refreshToken=')) return c;
  }
  return null;
}

function extractCookieValue(setCookieLine: string): string {
  // "refreshToken=abc; Path=/api/v1/auth; ..."
  const first = setCookieLine.split(';', 1)[0]!;
  return first.substring('refreshToken='.length);
}

beforeAll(() => {
  app = createServer();
});

beforeEach(() => {
  fixture = buildInMemoryRepos();
  const repos: AuthRepositories = {
    users: fixture.users,
    refreshTokens: fixture.refreshTokens,
  };
  setAuthRepositoriesForTests(repos);
});

afterAll(() => {
  // Reset the DI seam so other test files aren't affected by repo leakage.
  setAuthRepositoriesForTests(undefined);
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  it('400 when body is missing required fields', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('401 INVALID_CREDENTIALS when email does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@upj.ac.id', password: 'whatever1234' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('401 INVALID_CREDENTIALS when password is wrong', async () => {
    const passwordHash = await hashPassword('correct-horse-1');
    fixture.insertUser({
      email: 'jane@upj.ac.id',
      passwordHash,
      fullName: 'Jane',
      role: 'USER',
    });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'jane@upj.ac.id', password: 'wrong-password-9' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('403 ACCOUNT_DISABLED when user is inactive', async () => {
    const passwordHash = await hashPassword('correct-horse-1');
    fixture.insertUser({
      email: 'inactive@upj.ac.id',
      passwordHash,
      fullName: 'Inactive',
      role: 'USER',
      isActive: false,
    });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'inactive@upj.ac.id', password: 'correct-horse-1' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('200 + sets refreshToken cookie + returns access token on success', async () => {
    const passwordHash = await hashPassword('correct-horse-1');
    const inserted = fixture.insertUser({
      email: 'jane@upj.ac.id',
      passwordHash,
      fullName: 'Jane Kaprodi',
      role: 'USER',
    });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'jane@upj.ac.id', password: 'correct-horse-1' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.expiresIn).toBe(900);
    expect(res.body.user).toEqual({
      id: inserted.id,
      email: 'jane@upj.ac.id',
      fullName: 'Jane Kaprodi',
      role: 'user',
      lastLoginAt: expect.any(String),
    });

    const cookie = getRefreshCookie(res.headers['set-cookie']);
    expect(cookie).toBeTruthy();
    expect(cookie!).toContain('HttpOnly');
    expect(cookie!).toMatch(/SameSite=Strict/i);
    expect(cookie!).toMatch(/Path=\/api\/v1\/auth/i);
    // Max-Age is documented as 7 days = 604800 seconds. Express may emit
    // it as Max-Age=604800 plus an Expires; we only assert the Max-Age.
    expect(cookie!).toMatch(/Max-Age=604800/);

    // A row should now exist in the refresh-token store.
    expect(fixture.refreshStore.size).toBe(1);
  });
});

describe('GET /auth/me', () => {
  it('401 without bearer', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('401 with malformed bearer', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('200 with valid bearer returns the principal', async () => {
    const passwordHash = await hashPassword('correct-horse-1');
    const inserted = fixture.insertUser({
      email: 'admin@upj.ac.id',
      passwordHash,
      fullName: 'Admin',
      role: 'ADMIN',
    });
    const accessToken = signAccessToken({
      id: inserted.id,
      email: inserted.email,
      role: 'admin',
    });
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: inserted.id,
      email: 'admin@upj.ac.id',
      fullName: 'Admin',
      role: 'admin',
      lastLoginAt: null,
    });
  });
});

describe('POST /auth/refresh', () => {
  async function login(email: string, password: string) {
    return request(app).post('/api/v1/auth/login').send({ email, password });
  }

  it('rotates the cookie and revokes the old token', async () => {
    const passwordHash = await hashPassword('correct-horse-1');
    fixture.insertUser({
      email: 'jane@upj.ac.id',
      passwordHash,
      fullName: 'Jane',
      role: 'USER',
    });
    const loginRes = await login('jane@upj.ac.id', 'correct-horse-1');
    const oldCookie = getRefreshCookie(loginRes.headers['set-cookie'])!;
    expect(oldCookie).toBeTruthy();

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookie.split(';', 1)[0]!)
      .send();
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toEqual(expect.any(String));
    expect(refreshRes.body.expiresIn).toBe(900);

    const newCookie = getRefreshCookie(refreshRes.headers['set-cookie']);
    expect(newCookie).toBeTruthy();
    const newValue = extractCookieValue(newCookie!);
    const oldValue = extractCookieValue(oldCookie);
    expect(newValue).not.toEqual(oldValue);

    // Old row should be revoked, new row should be active.
    const rows = Array.from(fixture.refreshStore.values());
    expect(rows.length).toBe(2);
    const revoked = rows.filter((r) => r.revokedAt !== null);
    const active = rows.filter((r) => r.revokedAt === null);
    expect(revoked.length).toBe(1);
    expect(active.length).toBe(1);
  });

  it('rejects 401 REFRESH_TOKEN_INVALID when the old cookie is reused', async () => {
    const passwordHash = await hashPassword('correct-horse-1');
    fixture.insertUser({
      email: 'jane@upj.ac.id',
      passwordHash,
      fullName: 'Jane',
      role: 'USER',
    });
    const loginRes = await login('jane@upj.ac.id', 'correct-horse-1');
    const oldCookie = getRefreshCookie(loginRes.headers['set-cookie'])!;
    const cookieHeader = oldCookie.split(';', 1)[0]!;

    // First refresh succeeds and rotates.
    const ok = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader)
      .send();
    expect(ok.status).toBe(200);

    // Replay of the old cookie now fails.
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader)
      .send();
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    // Replay should also clear the cookie on the response.
    const cleared = getRefreshCookie(replay.headers['set-cookie']);
    expect(cleared).toBeTruthy();
    // express clearCookie emits an empty value with an Expires in the past.
    expect(cleared!).toMatch(/refreshToken=;/);
  });

  it('returns 401 when no refresh cookie is present', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });
});

describe('POST /auth/logout', () => {
  it('204 and revokes the active refresh token', async () => {
    const passwordHash = await hashPassword('correct-horse-1');
    const inserted = fixture.insertUser({
      email: 'jane@upj.ac.id',
      passwordHash,
      fullName: 'Jane',
      role: 'USER',
    });
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'jane@upj.ac.id', password: 'correct-horse-1' });
    const cookie = getRefreshCookie(loginRes.headers['set-cookie'])!.split(';', 1)[0]!;
    const accessToken = signAccessToken({
      id: inserted.id,
      email: inserted.email,
      role: 'user',
    });

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', cookie)
      .send();
    expect(res.status).toBe(204);
    expect(res.text).toBe('');

    // Refresh token should be revoked.
    const rows = Array.from(fixture.refreshStore.values());
    expect(rows.length).toBe(1);
    expect(rows[0]!.revokedAt).not.toBeNull();
  });

  it('401 without bearer', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send();
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/register', () => {
  it('401 without a bearer token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'new@upj.ac.id',
        password: 'super-secret-9',
        fullName: 'New User',
        role: 'user',
      });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not admin', async () => {
    const accessToken = signAccessToken({
      id: 1,
      email: 'user@upj.ac.id',
      role: 'user',
    });
    fixture.insertUser({
      id: 1,
      email: 'user@upj.ac.id',
      passwordHash: 'noop',
      fullName: 'User',
      role: 'USER',
    });
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        email: 'new@upj.ac.id',
        password: 'super-secret-9',
        fullName: 'New User',
        role: 'user',
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('400 on weak password', async () => {
    const accessToken = signAccessToken({
      id: 1,
      email: 'admin@upj.ac.id',
      role: 'admin',
    });
    fixture.insertUser({
      id: 1,
      email: 'admin@upj.ac.id',
      passwordHash: 'noop',
      fullName: 'Admin',
      role: 'ADMIN',
    });
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        email: 'new@upj.ac.id',
        password: 'short',
        fullName: 'New User',
        role: 'user',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('201 on success and returns the wire-shape user', async () => {
    const accessToken = signAccessToken({
      id: 1,
      email: 'admin@upj.ac.id',
      role: 'admin',
    });
    fixture.insertUser({
      id: 1,
      email: 'admin@upj.ac.id',
      passwordHash: 'noop',
      fullName: 'Admin',
      role: 'ADMIN',
    });
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        email: 'newuser@upj.ac.id',
        password: 'super-secret-9',
        fullName: 'Brand New',
        role: 'user',
      });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(Number),
      email: 'newuser@upj.ac.id',
      fullName: 'Brand New',
      role: 'user',
      isActive: true,
      createdAt: expect.any(String),
    });
  });

  it('409 EMAIL_ALREADY_USED on duplicate email', async () => {
    const accessToken = signAccessToken({
      id: 1,
      email: 'admin@upj.ac.id',
      role: 'admin',
    });
    fixture.insertUser({
      id: 1,
      email: 'admin@upj.ac.id',
      passwordHash: 'noop',
      fullName: 'Admin',
      role: 'ADMIN',
    });
    fixture.insertUser({
      email: 'taken@upj.ac.id',
      passwordHash: 'noop',
      fullName: 'Taken',
      role: 'USER',
    });
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        email: 'taken@upj.ac.id',
        password: 'super-secret-9',
        fullName: 'Brand New',
        role: 'user',
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_USED');
  });
});

