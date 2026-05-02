import { Router } from 'express';
import { createAuthRouter } from './routes/auth';
import { createUsersRouter } from './routes/users';
import { createSemestersRouter } from './routes/semesters';
import { createRoomsRouter } from './routes/rooms';
import { createTimeslotsRouter } from './routes/timeslots';
import { createFacilitiesRouter } from './routes/facilities';
import { createLockedRoomsRouter } from './routes/locked-rooms';
import { createLecturersRouter } from './routes/lecturers';
import { createCoursesRouter } from './routes/courses';
import { createCourseOfferingsRouter } from './routes/course-offerings';
import { createScheduleRunsRouter } from './routes/schedule-runs';

export function createV1Router(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  router.use('/auth', createAuthRouter());
  router.use('/users', createUsersRouter());
  router.use('/semesters', createSemestersRouter());
  router.use('/rooms', createRoomsRouter());
  router.use('/timeslots', createTimeslotsRouter());
  router.use('/facilities', createFacilitiesRouter());
  router.use('/locked-rooms', createLockedRoomsRouter());
  router.use('/lecturers', createLecturersRouter());
  router.use('/courses', createCoursesRouter());
  router.use('/course-offerings', createCourseOfferingsRouter());
  router.use('/schedule-runs', createScheduleRunsRouter());

  return router;
}
