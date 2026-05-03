/**
 * Phase 2 Task 5 — `/locked-rooms` route tests.
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

describe('GET /locked-rooms', () => {
  it('401 without bearer', async () => {
    const res = await request(app).get('/api/v1/locked-rooms');
    expect(res.status).toBe(401);
  });

  it('200 for user (read allowed)', async () => {
    seedUser();
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const room = fixture.insertRoom({ semesterId: sem.id, name: 'R', capacity: 30 });
    fixture.insertLockedRoom({
      semesterId: sem.id,
      offeringId: 5,
      roomId: room.id,
      lockedById: 1,
    });
    const res = await request(app).get('/api/v1/locked-rooms').set('Authorization', userBearer());
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
  });
});

describe('POST /locked-rooms', () => {
  it('403 for user', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const room = fixture.insertRoom({ semesterId: sem.id, name: 'R', capacity: 30 });
    const res = await request(app)
      .post('/api/v1/locked-rooms')
      .set('Authorization', userBearer())
      .send({ semesterId: sem.id, offeringId: 5, roomId: room.id });
    expect(res.status).toBe(403);
  });

  it('201 for admin and fills lockedById from req.user.id', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const room = fixture.insertRoom({ semesterId: sem.id, name: 'R', capacity: 30 });
    const res = await request(app)
      .post('/api/v1/locked-rooms')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, offeringId: 5, roomId: room.id, reason: 'Senate decree' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        semesterId: sem.id,
        offeringId: 5,
        roomId: room.id,
        lockedById: 1, // <- from req.user.id, NOT from body
        reason: 'Senate decree',
      }),
    );
  });

  it('400 when body tries to set lockedById (schema is strict)', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const room = fixture.insertRoom({ semesterId: sem.id, name: 'R', capacity: 30 });
    const res = await request(app)
      .post('/api/v1/locked-rooms')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, offeringId: 5, roomId: room.id, lockedById: 999 });
    expect(res.status).toBe(400);
  });

  it('409 when an offering already has a lock', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const room = fixture.insertRoom({ semesterId: sem.id, name: 'R', capacity: 30 });
    fixture.insertLockedRoom({
      semesterId: sem.id,
      offeringId: 5,
      roomId: room.id,
      lockedById: 1,
    });
    const res = await request(app)
      .post('/api/v1/locked-rooms')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, offeringId: 5, roomId: room.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OFFERING_ALREADY_LOCKED');
  });

  it('409 when a schedule run is RUNNING for the semester (techspec §2.1)', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const room = fixture.insertRoom({ semesterId: sem.id, name: 'R', capacity: 30 });
    fixture.runningScheduleRunSemesters.add(sem.id);
    const res = await request(app)
      .post('/api/v1/locked-rooms')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, offeringId: 5, roomId: room.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCHEDULE_RUN_RUNNING');
  });
});

describe('PATCH /locked-rooms/:id', () => {
  it('200 updates roomId + reason', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const r1 = fixture.insertRoom({ semesterId: sem.id, name: 'R1', capacity: 30 });
    const r2 = fixture.insertRoom({ semesterId: sem.id, name: 'R2', capacity: 30 });
    const lock = fixture.insertLockedRoom({
      semesterId: sem.id,
      offeringId: 5,
      roomId: r1.id,
      lockedById: 1,
    });
    const res = await request(app)
      .patch(`/api/v1/locked-rooms/${lock.id}`)
      .set('Authorization', adminBearer())
      .send({ roomId: r2.id, reason: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.roomId).toBe(r2.id);
    expect(res.body.reason).toBe('Updated');
  });

  it('409 when a run is RUNNING for the semester', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const room = fixture.insertRoom({ semesterId: sem.id, name: 'R', capacity: 30 });
    const lock = fixture.insertLockedRoom({
      semesterId: sem.id,
      offeringId: 5,
      roomId: room.id,
      lockedById: 1,
    });
    fixture.runningScheduleRunSemesters.add(sem.id);
    const res = await request(app)
      .patch(`/api/v1/locked-rooms/${lock.id}`)
      .set('Authorization', adminBearer())
      .send({ reason: 'Cannot change' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCHEDULE_RUN_RUNNING');
  });
});

describe('DELETE /locked-rooms/:id', () => {
  it('204', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const room = fixture.insertRoom({ semesterId: sem.id, name: 'R', capacity: 30 });
    const lock = fixture.insertLockedRoom({
      semesterId: sem.id,
      offeringId: 5,
      roomId: room.id,
      lockedById: 1,
    });
    const res = await request(app)
      .delete(`/api/v1/locked-rooms/${lock.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(204);
  });
});
