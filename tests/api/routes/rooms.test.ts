/**
 * Phase 2 Task 5 — `/rooms` route tests.
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

describe('GET /rooms', () => {
  it('401 without bearer', async () => {
    const res = await request(app).get('/api/v1/rooms');
    expect(res.status).toBe(401);
  });

  it('200 list for user (read allowed)', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    fixture.insertRoom({ semesterId: sem.id, name: 'R1', capacity: 30, facilities: ['LAB'] });
    const res = await request(app).get('/api/v1/rooms').set('Authorization', userBearer());
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].facilities).toEqual(['LAB']);
  });
});

describe('POST /rooms', () => {
  it('403 for user', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/rooms')
      .set('Authorization', userBearer())
      .send({ semesterId: sem.id, name: 'R1', capacity: 30, facilities: [] });
    expect(res.status).toBe(403);
  });

  it('201 for admin with facilities resolved', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    fixture.insertFacility({ code: 'LAB', label: 'Computer Lab' });
    const res = await request(app)
      .post('/api/v1/rooms')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, name: 'R1', capacity: 30, facilities: ['LAB'] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({ name: 'R1', capacity: 30, facilities: ['LAB'] }),
    );
  });

  it('400 UNKNOWN_FACILITY when a facility code is missing', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/rooms')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, name: 'R1', capacity: 30, facilities: ['NOPE'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_FACILITY');
  });

  it('409 on duplicate (semesterId + name)', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    fixture.insertRoom({ semesterId: sem.id, name: 'R1', capacity: 30 });
    const res = await request(app)
      .post('/api/v1/rooms')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, name: 'R1', capacity: 60, facilities: [] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROOM_NAME_TAKEN');
  });
});

describe('PATCH /rooms/:id', () => {
  it('updates facilities', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    fixture.insertFacility({ code: 'LAB', label: 'Lab' });
    fixture.insertFacility({ code: 'PROJ', label: 'Projector' });
    const room = fixture.insertRoom({ semesterId: sem.id, name: 'R1', capacity: 30, facilities: ['LAB'] });
    const res = await request(app)
      .patch(`/api/v1/rooms/${room.id}`)
      .set('Authorization', adminBearer())
      .send({ facilities: ['PROJ'] });
    expect(res.status).toBe(200);
    expect(res.body.facilities).toEqual(['PROJ']);
  });

  it('404 when missing', async () => {
    seedAdmin();
    const res = await request(app)
      .patch('/api/v1/rooms/9999')
      .set('Authorization', adminBearer())
      .send({ name: 'New' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /rooms/:id', () => {
  it('204', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const room = fixture.insertRoom({ semesterId: sem.id, name: 'R1', capacity: 30 });
    const res = await request(app)
      .delete(`/api/v1/rooms/${room.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(204);
  });
});
