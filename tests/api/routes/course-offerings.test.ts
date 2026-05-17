/**
 * Phase 2 Task 6 — `/course-offerings` route tests.
 *
 * Focus: §4.5 / §4.6 / §5.3.7 — POST is allowed for both roles but `user`
 * cannot set `isFixed` / `fixedTimeSlotIds`; full PATCH is admin-only; the
 * narrow PATCH /:id/student-count is allowed for both roles; DELETE is
 * admin-only.
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

interface SeededIds {
  semesterId: number;
  courseId: number;
  roomId: number;
  lecturerId: number;
  timeSlotId: number;
}

function seedDomain(): SeededIds {
  const sem = fixture.insertSemester({ code: 'S', label: 'L' });
  const room = fixture.insertRoom({ semesterId: sem.id, name: 'R1', capacity: 30 });
  const course = fixture.insertCourse({
    semesterId: sem.id,
    code: 'IF101',
    name: 'Intro',
    sks: 3,
  });
  const lec = fixture.insertLecturer({ semesterId: sem.id, name: 'A' });
  const slot = fixture.insertTimeSlot({
    semesterId: sem.id,
    day: 'MONDAY',
    startTime: '08:00',
    endTime: '10:00',
  });
  return {
    semesterId: sem.id,
    courseId: course.id,
    roomId: room.id,
    lecturerId: lec.id,
    timeSlotId: slot.id,
  };
}

describe('GET /course-offerings', () => {
  it('401 without bearer', async () => {
    const res = await request(app).get('/api/v1/course-offerings');
    expect(res.status).toBe(401);
  });

  it('200 list filterable by lecturerId', async () => {
    seedAdmin();
    const ids = seedDomain();
    fixture.insertCourseOffering({
      semesterId: ids.semesterId,
      courseId: ids.courseId,
      roomId: ids.roomId,
      effectiveStudentCount: 30,
      lecturerIds: [ids.lecturerId],
    });
    fixture.insertCourseOffering({
      semesterId: ids.semesterId,
      courseId: ids.courseId,
      roomId: ids.roomId,
      effectiveStudentCount: 25,
      lecturerIds: [],
    });
    const res = await request(app)
      .get(`/api/v1/course-offerings?lecturerId=${ids.lecturerId}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].lecturerIds).toEqual([ids.lecturerId]);
  });
});

describe('POST /course-offerings', () => {
  it('201 for user without isFixed (server forces false / [])', async () => {
    seedUser();
    const ids = seedDomain();
    const res = await request(app)
      .post('/api/v1/course-offerings')
      .set('Authorization', userBearer())
      .send({
        semesterId: ids.semesterId,
        courseId: ids.courseId,
        roomId: ids.roomId,
        effectiveStudentCount: 30,
        lecturerIds: [ids.lecturerId],
      });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        isFixed: false,
        fixedTimeSlotIds: [],
        createdById: 7,
        lecturerIds: [ids.lecturerId],
      }),
    );
  });

  it('400 FIELD_NOT_ALLOWED when user sets isFixed', async () => {
    seedUser();
    const ids = seedDomain();
    const res = await request(app)
      .post('/api/v1/course-offerings')
      .set('Authorization', userBearer())
      .send({
        semesterId: ids.semesterId,
        courseId: ids.courseId,
        roomId: ids.roomId,
        effectiveStudentCount: 30,
        lecturerIds: [ids.lecturerId],
        isFixed: true,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FIELD_NOT_ALLOWED');
  });

  it('400 FIELD_NOT_ALLOWED when user sets fixedTimeSlotIds', async () => {
    seedUser();
    const ids = seedDomain();
    const res = await request(app)
      .post('/api/v1/course-offerings')
      .set('Authorization', userBearer())
      .send({
        semesterId: ids.semesterId,
        courseId: ids.courseId,
        roomId: ids.roomId,
        effectiveStudentCount: 30,
        lecturerIds: [ids.lecturerId],
        fixedTimeSlotIds: [ids.timeSlotId],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FIELD_NOT_ALLOWED');
  });

  it('201 for admin with isFixed + fixedTimeSlotIds honored', async () => {
    seedAdmin();
    const ids = seedDomain();
    const res = await request(app)
      .post('/api/v1/course-offerings')
      .set('Authorization', adminBearer())
      .send({
        semesterId: ids.semesterId,
        courseId: ids.courseId,
        roomId: ids.roomId,
        effectiveStudentCount: 30,
        lecturerIds: [ids.lecturerId],
        isFixed: true,
        fixedTimeSlotIds: [ids.timeSlotId],
      });
    expect(res.status).toBe(201);
    expect(res.body.isFixed).toBe(true);
    expect(res.body.fixedTimeSlotIds).toEqual([ids.timeSlotId]);
  });

  it('201 without roomId, and GET returns roomId: null (Phase 7)', async () => {
    seedUser();
    const ids = seedDomain();
    const createRes = await request(app)
      .post('/api/v1/course-offerings')
      .set('Authorization', userBearer())
      .send({
        semesterId: ids.semesterId,
        courseId: ids.courseId,
        effectiveStudentCount: 30,
        lecturerIds: [ids.lecturerId],
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.roomId).toBeNull();

    const getRes = await request(app)
      .get(`/api/v1/course-offerings/${createRes.body.id}`)
      .set('Authorization', userBearer());
    expect(getRes.status).toBe(200);
    expect(getRes.body.roomId).toBeNull();
  });

  it('201 with explicit null roomId (Phase 7)', async () => {
    seedUser();
    const ids = seedDomain();
    const res = await request(app)
      .post('/api/v1/course-offerings')
      .set('Authorization', userBearer())
      .send({
        semesterId: ids.semesterId,
        courseId: ids.courseId,
        roomId: null,
        effectiveStudentCount: 30,
        lecturerIds: [ids.lecturerId],
      });
    expect(res.status).toBe(201);
    expect(res.body.roomId).toBeNull();
  });

  it('400 schema rejects empty lecturerIds', async () => {
    seedAdmin();
    const ids = seedDomain();
    const res = await request(app)
      .post('/api/v1/course-offerings')
      .set('Authorization', adminBearer())
      .send({
        semesterId: ids.semesterId,
        courseId: ids.courseId,
        roomId: ids.roomId,
        effectiveStudentCount: 30,
        lecturerIds: [],
      });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /course-offerings/:id (full)', () => {
  it('403 for user (admin-only)', async () => {
    seedUser();
    const ids = seedDomain();
    const offering = fixture.insertCourseOffering({
      semesterId: ids.semesterId,
      courseId: ids.courseId,
      roomId: ids.roomId,
      effectiveStudentCount: 30,
      lecturerIds: [ids.lecturerId],
    });
    const res = await request(app)
      .patch(`/api/v1/course-offerings/${offering.id}`)
      .set('Authorization', userBearer())
      .send({ effectiveStudentCount: 40 });
    expect(res.status).toBe(403);
  });

  it('200 for admin updates effectiveStudentCount + isFixed', async () => {
    seedAdmin();
    const ids = seedDomain();
    const offering = fixture.insertCourseOffering({
      semesterId: ids.semesterId,
      courseId: ids.courseId,
      roomId: ids.roomId,
      effectiveStudentCount: 30,
      lecturerIds: [ids.lecturerId],
    });
    const res = await request(app)
      .patch(`/api/v1/course-offerings/${offering.id}`)
      .set('Authorization', adminBearer())
      .send({ effectiveStudentCount: 40, isFixed: true });
    expect(res.status).toBe(200);
    expect(res.body.effectiveStudentCount).toBe(40);
    expect(res.body.isFixed).toBe(true);
  });

  it('404 when missing', async () => {
    seedAdmin();
    const res = await request(app)
      .patch('/api/v1/course-offerings/9999')
      .set('Authorization', adminBearer())
      .send({ effectiveStudentCount: 40 });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /course-offerings/:id/student-count', () => {
  it('200 for user (narrow endpoint allows both roles)', async () => {
    seedUser();
    const ids = seedDomain();
    const offering = fixture.insertCourseOffering({
      semesterId: ids.semesterId,
      courseId: ids.courseId,
      roomId: ids.roomId,
      effectiveStudentCount: 30,
      lecturerIds: [ids.lecturerId],
    });
    const res = await request(app)
      .patch(`/api/v1/course-offerings/${offering.id}/student-count`)
      .set('Authorization', userBearer())
      .send({ effectiveStudentCount: 45 });
    expect(res.status).toBe(200);
    expect(res.body.effectiveStudentCount).toBe(45);
  });

  it('400 on empty body', async () => {
    seedAdmin();
    const ids = seedDomain();
    const offering = fixture.insertCourseOffering({
      semesterId: ids.semesterId,
      courseId: ids.courseId,
      roomId: ids.roomId,
      effectiveStudentCount: 30,
      lecturerIds: [ids.lecturerId],
    });
    const res = await request(app)
      .patch(`/api/v1/course-offerings/${offering.id}/student-count`)
      .set('Authorization', adminBearer())
      .send({});
    expect(res.status).toBe(400);
  });

  it('404 when missing', async () => {
    seedAdmin();
    const res = await request(app)
      .patch('/api/v1/course-offerings/9999/student-count')
      .set('Authorization', adminBearer())
      .send({ effectiveStudentCount: 40 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /course-offerings/:id', () => {
  it('403 for user', async () => {
    seedUser();
    const ids = seedDomain();
    const offering = fixture.insertCourseOffering({
      semesterId: ids.semesterId,
      courseId: ids.courseId,
      roomId: ids.roomId,
      effectiveStudentCount: 30,
      lecturerIds: [ids.lecturerId],
    });
    const res = await request(app)
      .delete(`/api/v1/course-offerings/${offering.id}`)
      .set('Authorization', userBearer());
    expect(res.status).toBe(403);
  });

  it('204 for admin', async () => {
    seedAdmin();
    const ids = seedDomain();
    const offering = fixture.insertCourseOffering({
      semesterId: ids.semesterId,
      courseId: ids.courseId,
      roomId: ids.roomId,
      effectiveStudentCount: 30,
      lecturerIds: [ids.lecturerId],
    });
    const res = await request(app)
      .delete(`/api/v1/course-offerings/${offering.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(204);
  });
});
