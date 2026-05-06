import { Router } from 'express';
import { getReadinessChecker } from './lib/readiness';
import { getOpenApiDocument } from './openapi/registry';
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

  // OpenAPI document is mounted first so a developer's `curl /api/v1/openapi.json`
  // resolves before any auth-guarded route. Document is generated once per
  // process at first call (see `getOpenApiDocument`) and the same JSON is
  // served thereafter; we set Cache-Control so a Swagger UI workflow can
  // reuse the response without re-fetching every keystroke.
  router.get('/openapi.json', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json(getOpenApiDocument());
  });

  router.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  // Readiness probe (api_design §5.3.9). Returns 200 only when both DB and
  // Redis pings succeed; 503 otherwise. Each ping is bounded by a short
  // timeout in `lib/readiness.ts` so the probe never hangs the request.
  router.get('/ready', async (req, res) => {
    const checker = getReadinessChecker();
    const [dbResult, redisResult] = await Promise.allSettled([
      checker.pingDb(),
      checker.pingRedis(),
    ]);

    const dbOk = dbResult.status === 'fulfilled' && dbResult.value === true;
    const redisOk = redisResult.status === 'fulfilled' && redisResult.value === true;

    // Log the underlying error at warn level (with req.log so the request id
    // is attached) but never leak it into the response body.
    if (dbResult.status === 'rejected') {
      req.log?.warn({ err: dbResult.reason }, 'readiness: db ping failed');
    }
    if (redisResult.status === 'rejected') {
      req.log?.warn({ err: redisResult.reason }, 'readiness: redis ping failed');
    }

    const allOk = dbOk && redisOk;
    res.status(allOk ? 200 : 503).json({
      status: allOk ? 'ready' : 'not_ready',
      checks: {
        db: dbOk ? 'ok' : 'fail',
        redis: redisOk ? 'ok' : 'fail',
      },
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
