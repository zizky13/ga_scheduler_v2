/**
 * Phase 2 Task 5 — `/facilities` route tests.
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

const adminBearer = () => `Bearer ${signAccessToken({ id: 1, email: 'a@upj.ac.id', role: 'admin' })}`;
const userBearer = () => `Bearer ${signAccessToken({ id: 7, email: 'u@upj.ac.id', role: 'user' })}`;

function seedAdmin(): void {
  fixture.insertUser({ id: 1, email: 'a@upj.ac.id', fullName: 'A', role: 'ADMIN' });
}
function seedUser(): void {
  fixture.insertUser({ id: 7, email: 'u@upj.ac.id', fullName: 'U', role: 'USER' });
}

describe('GET /facilities', () => {
  it('401 without bearer', async () => {
    const res = await request(app).get('/api/v1/facilities');
    expect(res.status).toBe(401);
  });

  it('200 for user', async () => {
    seedUser();
    fixture.insertFacility({ code: 'LAB', label: 'Lab' });
    const res = await request(app).get('/api/v1/facilities').set('Authorization', userBearer());
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
  });
});

describe('POST /facilities', () => {
  it('403 for user', async () => {
    seedUser();
    const res = await request(app)
      .post('/api/v1/facilities')
      .set('Authorization', userBearer())
      .send({ code: 'LAB', label: 'Lab' });
    expect(res.status).toBe(403);
  });

  it('201 for admin', async () => {
    seedAdmin();
    const res = await request(app)
      .post('/api/v1/facilities')
      .set('Authorization', adminBearer())
      .send({ code: 'LAB', label: 'Lab' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ code: 'LAB', label: 'Lab' }));
  });

  it('409 on duplicate code', async () => {
    seedAdmin();
    fixture.insertFacility({ code: 'LAB', label: 'Lab' });
    const res = await request(app)
      .post('/api/v1/facilities')
      .set('Authorization', adminBearer())
      .send({ code: 'LAB', label: 'Other' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FACILITY_CODE_TAKEN');
  });
});

describe('PATCH /facilities/:id', () => {
  it('200 updates label', async () => {
    seedAdmin();
    const f = fixture.insertFacility({ code: 'LAB', label: 'Old' });
    const res = await request(app)
      .patch(`/api/v1/facilities/${f.id}`)
      .set('Authorization', adminBearer())
      .send({ label: 'New' });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('New');
  });

  it('404 when missing', async () => {
    seedAdmin();
    const res = await request(app)
      .patch('/api/v1/facilities/9999')
      .set('Authorization', adminBearer())
      .send({ label: 'New' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /facilities/:id', () => {
  it('204', async () => {
    seedAdmin();
    const f = fixture.insertFacility({ code: 'LAB', label: 'Lab' });
    const res = await request(app)
      .delete(`/api/v1/facilities/${f.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(204);
  });

  it('409 when referenced by a room', async () => {
    seedAdmin();
    const f = fixture.insertFacility({ code: 'LAB', label: 'Lab' });
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    fixture.insertRoom({ semesterId: sem.id, name: 'R1', capacity: 30, facilities: ['LAB'] });
    const res = await request(app)
      .delete(`/api/v1/facilities/${f.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FACILITY_REFERENCED');
  });
});
