/**
 * Phase 2 Task 5 — `/users` route tests.
 *
 * Strategy mirrors `tests/api/routes/auth.test.ts`: install in-memory CRUD
 * repos via `setCrudRepositoriesForTests()` so the real handlers + middleware
 * (auth, role gate, validation, error envelope) run end-to-end without
 * Prisma. Permission-matrix coverage is the focus, not row-by-row CRUD
 * mechanics.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

import { createServer } from '../../../src/api/server';
import { setCrudRepositoriesForTests } from '../../../src/api/lib/crudContext';
import { signAccessToken } from '../../../src/api/lib/auth';
import { buildCrudFixture, type CrudFixture } from './_crudFixture';

let app: Application;
let fixture: CrudFixture;

beforeAll(() => {
  app = createServer();
});

beforeEach(() => {
  fixture = buildCrudFixture();
  setCrudRepositoriesForTests(fixture.repos);
});

afterAll(() => {
  setCrudRepositoriesForTests(undefined);
});

function bearerFor(id: number, role: 'admin' | 'user' = 'admin'): string {
  return `Bearer ${signAccessToken({ id, email: `${role}@upj.ac.id`, role })}`;
}

describe('GET /users', () => {
  it('401 without bearer', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });

  it('403 when caller is a regular user', async () => {
    fixture.insertUser({ id: 7, email: 'kaprodi@upj.ac.id', fullName: 'Kaprodi', role: 'USER' });
    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', bearerFor(7, 'user'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('200 returns paginated list for admin', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'Admin', role: 'ADMIN' });
    fixture.insertUser({ email: 'jane@upj.ac.id', fullName: 'Jane', role: 'USER' });
    fixture.insertUser({ email: 'john@upj.ac.id', fullName: 'John', role: 'USER' });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', bearerFor(1, 'admin'));
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 50, total: 3 });
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0]).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        email: expect.any(String),
        role: expect.stringMatching(/admin|user/),
        isActive: true,
      }),
    );
  });

  it('filters by role', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'Admin', role: 'ADMIN' });
    fixture.insertUser({ email: 'a@upj.ac.id', fullName: 'A', role: 'USER' });
    fixture.insertUser({ email: 'b@upj.ac.id', fullName: 'B', role: 'USER' });

    const res = await request(app)
      .get('/api/v1/users?role=user')
      .set('Authorization', bearerFor(1, 'admin'));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    for (const u of res.body.data) expect(u.role).toBe('user');
  });
});

describe('GET /users/:id', () => {
  it('200 returns user', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'Admin', role: 'ADMIN' });
    const target = fixture.insertUser({ email: 'jane@upj.ac.id', fullName: 'Jane', role: 'USER' });
    const res = await request(app)
      .get(`/api/v1/users/${target.id}`)
      .set('Authorization', bearerFor(1, 'admin'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({ id: target.id, email: 'jane@upj.ac.id', role: 'user' }),
    );
  });

  it('404 when missing', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'Admin', role: 'ADMIN' });
    const res = await request(app)
      .get('/api/v1/users/9999')
      .set('Authorization', bearerFor(1, 'admin'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('PATCH /users/:id', () => {
  it('updates fullName + role', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'Admin', role: 'ADMIN' });
    const target = fixture.insertUser({ email: 'jane@upj.ac.id', fullName: 'Jane', role: 'USER' });
    const res = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set('Authorization', bearerFor(1, 'admin'))
      .send({ fullName: 'Jane K.', role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Jane K.');
    expect(res.body.role).toBe('admin');
  });

  it('400 on empty body', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'Admin', role: 'ADMIN' });
    const target = fixture.insertUser({ email: 'jane@upj.ac.id', fullName: 'Jane', role: 'USER' });
    const res = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set('Authorization', bearerFor(1, 'admin'))
      .send({});
    expect(res.status).toBe(400);
  });

  it('403 when admin tries to demote themselves (§5.3.2)', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'Admin', role: 'ADMIN' });
    const res = await request(app)
      .patch('/api/v1/users/1')
      .set('Authorization', bearerFor(1, 'admin'))
      .send({ role: 'user' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_DEMOTION_FORBIDDEN');
  });

  it('403 when admin tries to deactivate themselves', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'Admin', role: 'ADMIN' });
    const res = await request(app)
      .patch('/api/v1/users/1')
      .set('Authorization', bearerFor(1, 'admin'))
      .send({ isActive: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_DEACTIVATION_FORBIDDEN');
  });

  it('400 when body contains an unknown field (e.g., email — schema is strict)', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'Admin', role: 'ADMIN' });
    const target = fixture.insertUser({ email: 'jane@upj.ac.id', fullName: 'Jane', role: 'USER' });
    const res = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set('Authorization', bearerFor(1, 'admin'))
      .send({ email: 'changed@upj.ac.id' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('DELETE /users/:id', () => {
  it('204 soft-deactivates a user', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'Admin', role: 'ADMIN' });
    const target = fixture.insertUser({ email: 'jane@upj.ac.id', fullName: 'Jane', role: 'USER' });
    const res = await request(app)
      .delete(`/api/v1/users/${target.id}`)
      .set('Authorization', bearerFor(1, 'admin'));
    expect(res.status).toBe(204);
    expect(fixture.userStore.get(target.id)?.isActive).toBe(false);
  });

  it('403 when admin tries to deactivate themselves', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'Admin', role: 'ADMIN' });
    const res = await request(app)
      .delete('/api/v1/users/1')
      .set('Authorization', bearerFor(1, 'admin'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_DEACTIVATION_FORBIDDEN');
  });

  it('409 when user is already deactivated', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'Admin', role: 'ADMIN' });
    const target = fixture.insertUser({
      email: 'jane@upj.ac.id',
      fullName: 'Jane',
      role: 'USER',
      isActive: false,
    });
    const res = await request(app)
      .delete(`/api/v1/users/${target.id}`)
      .set('Authorization', bearerFor(1, 'admin'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_DEACTIVATED');
  });
});
