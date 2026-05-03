/**
 * Phase 2 Task 5 — `/timeslots` route tests.
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

describe('GET /timeslots', () => {
  it('401 without bearer', async () => {
    const res = await request(app).get('/api/v1/timeslots');
    expect(res.status).toBe(401);
  });

  it('200 for user (read allowed)', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    fixture.insertTimeSlot({ semesterId: sem.id, day: 'MONDAY', startTime: '08:00', endTime: '10:00' });
    const res = await request(app).get('/api/v1/timeslots').set('Authorization', userBearer());
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
  });
});

describe('POST /timeslots', () => {
  it('403 for user', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/timeslots')
      .set('Authorization', userBearer())
      .send({ semesterId: sem.id, day: 'MONDAY', startTime: '08:00', endTime: '10:00' });
    expect(res.status).toBe(403);
  });

  it('201 for admin', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/timeslots')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, day: 'MONDAY', startTime: '08:00', endTime: '10:00' });
    expect(res.status).toBe(201);
    expect(res.body.day).toBe('MONDAY');
  });

  it('400 when start >= end', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/timeslots')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, day: 'MONDAY', startTime: '10:00', endTime: '08:00' });
    expect(res.status).toBe(400);
  });

  it('409 on duplicate', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    fixture.insertTimeSlot({ semesterId: sem.id, day: 'MONDAY', startTime: '08:00', endTime: '10:00' });
    const res = await request(app)
      .post('/api/v1/timeslots')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, day: 'MONDAY', startTime: '08:00', endTime: '10:00' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TIMESLOT_TAKEN');
  });
});

describe('PATCH /timeslots/:id', () => {
  it('400 when patched window is invalid', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const t = fixture.insertTimeSlot({
      semesterId: sem.id,
      day: 'MONDAY',
      startTime: '08:00',
      endTime: '10:00',
    });
    const res = await request(app)
      .patch(`/api/v1/timeslots/${t.id}`)
      .set('Authorization', adminBearer())
      .send({ endTime: '07:00' });
    expect(res.status).toBe(400);
  });

  it('200 on valid window patch', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const t = fixture.insertTimeSlot({
      semesterId: sem.id,
      day: 'MONDAY',
      startTime: '08:00',
      endTime: '10:00',
    });
    const res = await request(app)
      .patch(`/api/v1/timeslots/${t.id}`)
      .set('Authorization', adminBearer())
      .send({ endTime: '11:00' });
    expect(res.status).toBe(200);
    expect(res.body.endTime).toBe('11:00');
  });
});

describe('DELETE /timeslots/:id', () => {
  it('204', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const t = fixture.insertTimeSlot({
      semesterId: sem.id,
      day: 'MONDAY',
      startTime: '08:00',
      endTime: '10:00',
    });
    const res = await request(app)
      .delete(`/api/v1/timeslots/${t.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(204);
  });
});
