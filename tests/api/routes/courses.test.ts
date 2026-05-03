/**
 * Phase 2 Task 6 — `/courses` route tests.
 *
 * Focus: §4.5 / §5.3.6 — both `admin` and `user` may create/update; only
 * `admin` may delete; `requiredCompetencies` editable by both roles.
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

describe('GET /courses', () => {
  it('401 without bearer', async () => {
    const res = await request(app).get('/api/v1/courses');
    expect(res.status).toBe(401);
  });

  it('200 list for user (read allowed)', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    fixture.insertCourse({
      semesterId: sem.id,
      code: 'IF101',
      name: 'Intro',
      sks: 3,
      requiredCompetencies: ['algorithms'],
    });
    const res = await request(app).get('/api/v1/courses').set('Authorization', userBearer());
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].requiredCompetencies).toEqual(['algorithms']);
  });
});

describe('POST /courses', () => {
  it('201 for user with requiredCompetencies (editable by both roles)', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/courses')
      .set('Authorization', userBearer())
      .send({
        semesterId: sem.id,
        code: 'IF101',
        name: 'Intro',
        sks: 3,
        requiredCompetencies: ['ai-ml', 'algorithms'],
      });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        code: 'IF101',
        sks: 3,
        createdById: 7,
      }),
    );
    expect(res.body.requiredCompetencies).toEqual(
      expect.arrayContaining(['ai-ml', 'algorithms']),
    );
  });

  it('201 for admin with requiredFacilities resolved', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    fixture.insertFacility({ code: 'LAB', label: 'Lab' });
    const res = await request(app)
      .post('/api/v1/courses')
      .set('Authorization', adminBearer())
      .send({
        semesterId: sem.id,
        code: 'IF101',
        name: 'Intro',
        sks: 3,
        requiredFacilities: ['LAB'],
      });
    expect(res.status).toBe(201);
    expect(res.body.requiredFacilities).toEqual(['LAB']);
  });

  it('400 UNKNOWN_FACILITY when an unknown code is passed', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/courses')
      .set('Authorization', adminBearer())
      .send({
        semesterId: sem.id,
        code: 'IF101',
        name: 'Intro',
        sks: 3,
        requiredFacilities: ['NOPE'],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_FACILITY');
  });

  it('409 COURSE_CODE_TAKEN on (semesterId, code) duplicate', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    fixture.insertCourse({ semesterId: sem.id, code: 'IF101', name: 'Intro', sks: 3 });
    const res = await request(app)
      .post('/api/v1/courses')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, code: 'IF101', name: 'Other', sks: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_CODE_TAKEN');
  });
});

describe('PATCH /courses/:id', () => {
  it('user can update requiredCompetencies', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const c = fixture.insertCourse({
      semesterId: sem.id,
      code: 'IF101',
      name: 'Intro',
      sks: 3,
    });
    const res = await request(app)
      .patch(`/api/v1/courses/${c.id}`)
      .set('Authorization', userBearer())
      .send({ requiredCompetencies: ['ai-ml'] });
    expect(res.status).toBe(200);
    expect(res.body.requiredCompetencies).toEqual(['ai-ml']);
  });

  it('404 when missing', async () => {
    seedAdmin();
    const res = await request(app)
      .patch('/api/v1/courses/9999')
      .set('Authorization', adminBearer())
      .send({ name: 'New' });
    expect(res.status).toBe(404);
  });

  it('400 on empty body', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const c = fixture.insertCourse({
      semesterId: sem.id,
      code: 'IF101',
      name: 'Intro',
      sks: 3,
    });
    const res = await request(app)
      .patch(`/api/v1/courses/${c.id}`)
      .set('Authorization', adminBearer())
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /courses/:id', () => {
  it('403 for user', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const c = fixture.insertCourse({
      semesterId: sem.id,
      code: 'IF101',
      name: 'Intro',
      sks: 3,
    });
    const res = await request(app)
      .delete(`/api/v1/courses/${c.id}`)
      .set('Authorization', userBearer());
    expect(res.status).toBe(403);
  });

  it('204 for admin', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const c = fixture.insertCourse({
      semesterId: sem.id,
      code: 'IF101',
      name: 'Intro',
      sks: 3,
    });
    const res = await request(app)
      .delete(`/api/v1/courses/${c.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(204);
  });

  it('409 COURSE_REFERENCED when an offering references the course', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const room = fixture.insertRoom({ semesterId: sem.id, name: 'R1', capacity: 30 });
    const course = fixture.insertCourse({
      semesterId: sem.id,
      code: 'IF101',
      name: 'Intro',
      sks: 3,
    });
    fixture.insertCourseOffering({
      semesterId: sem.id,
      courseId: course.id,
      roomId: room.id,
      effectiveStudentCount: 30,
    });
    const res = await request(app)
      .delete(`/api/v1/courses/${course.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_REFERENCED');
  });
});
