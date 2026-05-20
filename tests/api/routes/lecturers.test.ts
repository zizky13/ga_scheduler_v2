/**
 * Phase 2 Task 6 — `/lecturers` route tests.
 *
 * Focus: permission matrix from api_design §4.5 + field-level rules from
 * §4.6 / §5.3.5. Both `admin` and `user` may read/write; `isStructural` is
 * admin-only on POST/PATCH; `competencies` is editable by both roles; DELETE
 * is admin-only and 409s when referenced by an offering.
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

describe('GET /lecturers', () => {
  it('401 without bearer', async () => {
    const res = await request(app).get('/api/v1/lecturers');
    expect(res.status).toBe(401);
  });

  it('200 list for user (read allowed for both roles)', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    fixture.insertLecturer({ semesterId: sem.id, name: 'Dr. A', competencies: ['ai-ml'] });
    const res = await request(app).get('/api/v1/lecturers').set('Authorization', userBearer());
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0]).toEqual(
      expect.objectContaining({ name: 'Dr. A', competencies: ['ai-ml'] }),
    );
  });

  it('filters by semesterId', async () => {
    seedAdmin();
    const sem1 = fixture.insertSemester({ code: 'S1', label: 'L1' });
    const sem2 = fixture.insertSemester({ code: 'S2', label: 'L2' });
    fixture.insertLecturer({ semesterId: sem1.id, name: 'A' });
    fixture.insertLecturer({ semesterId: sem2.id, name: 'B' });
    const res = await request(app)
      .get(`/api/v1/lecturers?semesterId=${sem1.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].name).toBe('A');
  });
});

describe('GET /lecturers/:id', () => {
  it('200 returns lecturer', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const l = fixture.insertLecturer({ semesterId: sem.id, name: 'Dr. A' });
    const res = await request(app)
      .get(`/api/v1/lecturers/${l.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(l.id);
  });

  it('404 when missing', async () => {
    seedAdmin();
    const res = await request(app)
      .get('/api/v1/lecturers/9999')
      .set('Authorization', adminBearer());
    expect(res.status).toBe(404);
  });
});

describe('POST /lecturers', () => {
  it('201 for user without isStructural (server forces false)', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/lecturers')
      .set('Authorization', userBearer())
      .send({ semesterId: sem.id, name: 'Dr. A', competencies: ['algorithms'] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        name: 'Dr. A',
        isStructural: false,
        competencies: ['algorithms'],
        createdById: 7, // from req.user.id
      }),
    );
  });

  it('400 FIELD_NOT_ALLOWED when user tries to set isStructural', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/lecturers')
      .set('Authorization', userBearer())
      .send({ semesterId: sem.id, name: 'Dr. A', isStructural: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FIELD_NOT_ALLOWED');
  });

  it('201 for admin with isStructural=true honored', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/lecturers')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, name: 'Dean A', isStructural: true });
    expect(res.status).toBe(201);
    expect(res.body.isStructural).toBe(true);
    expect(res.body.createdById).toBe(1);
  });

  it('user can set competencies (api_design §5.3.5 note)', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/lecturers')
      .set('Authorization', userBearer())
      .send({
        semesterId: sem.id,
        name: 'Dr. B',
        competencies: ['databases', 'algorithms'],
      });
    expect(res.status).toBe(201);
    expect(res.body.competencies).toEqual(
      expect.arrayContaining(['databases', 'algorithms']),
    );
  });

  it('defaults maxSks to 6 for structural lecturers when omitted', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/lecturers')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, name: 'Dean', isStructural: true });
    expect(res.status).toBe(201);
    expect(res.body.maxSks).toBe(6);
  });

  it('defaults maxSks to 12 for non-structural lecturers when omitted', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/lecturers')
      .set('Authorization', userBearer())
      .send({ semesterId: sem.id, name: 'Dr. C' });
    expect(res.status).toBe(201);
    expect(res.body.maxSks).toBe(12);
  });

  it('honors explicit maxSks regardless of isStructural', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/lecturers')
      .set('Authorization', adminBearer())
      .send({ semesterId: sem.id, name: 'Dr. D', isStructural: true, maxSks: 9 });
    expect(res.status).toBe(201);
    expect(res.body.maxSks).toBe(9);
  });

  it('user can set maxSks (OQ-13 working assumption: user-editable)', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const res = await request(app)
      .post('/api/v1/lecturers')
      .set('Authorization', userBearer())
      .send({ semesterId: sem.id, name: 'Dr. E', maxSks: 9 });
    expect(res.status).toBe(201);
    expect(res.body.maxSks).toBe(9);
  });
});

describe('PATCH /lecturers/:id', () => {
  it('user can update name + competencies', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const l = fixture.insertLecturer({ semesterId: sem.id, name: 'Old' });
    const res = await request(app)
      .patch(`/api/v1/lecturers/${l.id}`)
      .set('Authorization', userBearer())
      .send({ name: 'New', competencies: ['ai-ml'] });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
    expect(res.body.competencies).toEqual(['ai-ml']);
  });

  it('400 FIELD_NOT_ALLOWED when user tries to PATCH isStructural', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const l = fixture.insertLecturer({ semesterId: sem.id, name: 'A' });
    const res = await request(app)
      .patch(`/api/v1/lecturers/${l.id}`)
      .set('Authorization', userBearer())
      .send({ isStructural: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FIELD_NOT_ALLOWED');
  });

  it('admin can PATCH isStructural', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const l = fixture.insertLecturer({ semesterId: sem.id, name: 'A', isStructural: false });
    const res = await request(app)
      .patch(`/api/v1/lecturers/${l.id}`)
      .set('Authorization', adminBearer())
      .send({ isStructural: true });
    expect(res.status).toBe(200);
    expect(res.body.isStructural).toBe(true);
  });

  it('404 when missing', async () => {
    seedAdmin();
    const res = await request(app)
      .patch('/api/v1/lecturers/9999')
      .set('Authorization', adminBearer())
      .send({ name: 'New' });
    expect(res.status).toBe(404);
  });

  it('400 on empty body', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const l = fixture.insertLecturer({ semesterId: sem.id, name: 'A' });
    const res = await request(app)
      .patch(`/api/v1/lecturers/${l.id}`)
      .set('Authorization', adminBearer())
      .send({});
    expect(res.status).toBe(400);
  });

  it('user can PATCH maxSks (OQ-13 working assumption: user-editable)', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const l = fixture.insertLecturer({ semesterId: sem.id, name: 'A', maxSks: 12 });
    const res = await request(app)
      .patch(`/api/v1/lecturers/${l.id}`)
      .set('Authorization', userBearer())
      .send({ maxSks: 15 });
    expect(res.status).toBe(200);
    expect(res.body.maxSks).toBe(15);
  });

  it('admin PATCH isStructural toggle preserves the typed maxSks', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const l = fixture.insertLecturer({
      semesterId: sem.id,
      name: 'A',
      isStructural: false,
      maxSks: 9,
    });
    const res = await request(app)
      .patch(`/api/v1/lecturers/${l.id}`)
      .set('Authorization', adminBearer())
      .send({ isStructural: true });
    expect(res.status).toBe(200);
    expect(res.body.isStructural).toBe(true);
    expect(res.body.maxSks).toBe(9);
  });
});

describe('DELETE /lecturers/:id', () => {
  it('403 for user (admin-only)', async () => {
    seedUser();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const l = fixture.insertLecturer({ semesterId: sem.id, name: 'A' });
    const res = await request(app)
      .delete(`/api/v1/lecturers/${l.id}`)
      .set('Authorization', userBearer());
    expect(res.status).toBe(403);
  });

  it('204 for admin', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const l = fixture.insertLecturer({ semesterId: sem.id, name: 'A' });
    const res = await request(app)
      .delete(`/api/v1/lecturers/${l.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(204);
  });

  it('409 LECTURER_REFERENCED when offering references the lecturer', async () => {
    seedAdmin();
    const sem = fixture.insertSemester({ code: 'S', label: 'L' });
    const room = fixture.insertRoom({ semesterId: sem.id, name: 'R1', capacity: 30 });
    const course = fixture.insertCourse({
      semesterId: sem.id,
      code: 'IF101',
      name: 'Intro',
      sks: 3,
    });
    const lec = fixture.insertLecturer({ semesterId: sem.id, name: 'A' });
    fixture.insertCourseOffering({
      semesterId: sem.id,
      courseId: course.id,
      roomId: room.id,
      effectiveStudentCount: 30,
      lecturerIds: [lec.id],
    });
    const res = await request(app)
      .delete(`/api/v1/lecturers/${lec.id}`)
      .set('Authorization', adminBearer());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LECTURER_REFERENCED');
  });

  it('404 when missing', async () => {
    seedAdmin();
    const res = await request(app)
      .delete('/api/v1/lecturers/9999')
      .set('Authorization', adminBearer());
    expect(res.status).toBe(404);
  });
});
