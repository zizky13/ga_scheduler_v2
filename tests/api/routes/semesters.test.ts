/**
 * Phase 2 Task 5 — `/semesters` route tests.
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

const adminBearer = (id = 1) =>
  `Bearer ${signAccessToken({ id, email: 'admin@upj.ac.id', role: 'admin' })}`;
const userBearer = (id = 7) =>
  `Bearer ${signAccessToken({ id, email: 'user@upj.ac.id', role: 'user' })}`;

const VALID_BODY = {
  code: '2025-GANJIL',
  label: 'Semester Ganjil 2025/2026',
  startsOn: '2025-09-01T00:00:00Z',
  endsOn: '2026-01-31T00:00:00Z',
};

describe('GET /semesters', () => {
  it('401 without bearer', async () => {
    const res = await request(app).get('/api/v1/semesters');
    expect(res.status).toBe(401);
  });

  it('200 for user (read allowed)', async () => {
    fixture.insertUser({ id: 7, email: 'user@upj.ac.id', fullName: 'U', role: 'USER' });
    fixture.insertSemester({ code: '2025-GANJIL', label: 'L' });
    const res = await request(app).get('/api/v1/semesters').set('Authorization', userBearer());
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
  });
});

describe('POST /semesters', () => {
  it('403 when caller is user', async () => {
    fixture.insertUser({ id: 7, email: 'user@upj.ac.id', fullName: 'U', role: 'USER' });
    const res = await request(app)
      .post('/api/v1/semesters')
      .set('Authorization', userBearer())
      .send(VALID_BODY);
    expect(res.status).toBe(403);
  });

  it('201 for admin', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'A', role: 'ADMIN' });
    const res = await request(app)
      .post('/api/v1/semesters')
      .set('Authorization', adminBearer())
      .send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({ code: '2025-GANJIL', label: 'Semester Ganjil 2025/2026', isActive: false }),
    );
  });

  it('409 on duplicate code', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'A', role: 'ADMIN' });
    fixture.insertSemester({ code: '2025-GANJIL', label: 'L' });
    const res = await request(app)
      .post('/api/v1/semesters')
      .set('Authorization', adminBearer())
      .send(VALID_BODY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEMESTER_CODE_TAKEN');
  });

  it('400 when startsOn >= endsOn', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'A', role: 'ADMIN' });
    const res = await request(app)
      .post('/api/v1/semesters')
      .set('Authorization', adminBearer())
      .send({ ...VALID_BODY, endsOn: '2024-12-31T00:00:00Z' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /semesters/:id', () => {
  it('200 updates label', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'A', role: 'ADMIN' });
    const sem = fixture.insertSemester({ code: '2025-GANJIL', label: 'Old' });
    const res = await request(app)
      .patch(`/api/v1/semesters/${sem.id}`)
      .set('Authorization', adminBearer())
      .send({ label: 'New label' });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('New label');
  });

  it('400 when body tries to set immutable code (§5.3.3 — code is immutable post-create)', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'A', role: 'ADMIN' });
    const sem = fixture.insertSemester({ code: '2025-GANJIL', label: 'Old' });
    const res = await request(app)
      .patch(`/api/v1/semesters/${sem.id}`)
      .set('Authorization', adminBearer())
      .send({ code: '2026-GANJIL' });
    expect(res.status).toBe(400);
  });
});

describe('POST /semesters/:id/activate', () => {
  it('200 sets target active and unsets all others', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'A', role: 'ADMIN' });
    const sa = fixture.insertSemester({ code: 'A', label: 'A', isActive: true });
    const sb = fixture.insertSemester({ code: 'B', label: 'B' });
    const res = await request(app)
      .post(`/api/v1/semesters/${sb.id}/activate`)
      .set('Authorization', adminBearer())
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);
    expect(fixture.semesterStore.get(sa.id)?.isActive).toBe(false);
  });
});

describe('DELETE /semesters/:id', () => {
  it('204 when not active and no related rows', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'A', role: 'ADMIN' });
    const sem = fixture.insertSemester({ code: 'X', label: 'L' });
    const res = await request(app)
      .delete(`/api/v1/semesters/${sem.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(204);
  });

  it('409 when active', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'A', role: 'ADMIN' });
    const sem = fixture.insertSemester({ code: 'X', label: 'L', isActive: true });
    const res = await request(app)
      .delete(`/api/v1/semesters/${sem.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEMESTER_ACTIVE');
  });

  it('409 when related rows exist', async () => {
    fixture.insertUser({ id: 1, email: 'admin@upj.ac.id', fullName: 'A', role: 'ADMIN' });
    const sem = fixture.insertSemester({ code: 'X', label: 'L' });
    fixture.insertRoom({ semesterId: sem.id, name: 'R1', capacity: 30 });
    const res = await request(app)
      .delete(`/api/v1/semesters/${sem.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEMESTER_HAS_RELATED_ROWS');
  });
});
