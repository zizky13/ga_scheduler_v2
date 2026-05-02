import { Router } from 'express';

/**
 * v1 router.
 *
 * Currently mounts only GET /health (api_design §5.3.9). Subsequent Phase 2
 * tasks attach the remaining route groups here:
 *   - /auth                  (Phase 2 Task 3)
 *   - /users                 (Phase 2 Task 5)
 *   - /semesters             (Phase 2 Task 5)
 *   - /rooms                 (Phase 2 Task 5)
 *   - /timeslots             (Phase 2 Task 5)
 *   - /facilities            (Phase 2 Task 5)
 *   - /locked-rooms          (Phase 2 Task 5)
 *   - /lecturers             (Phase 2 Task 6)
 *   - /courses               (Phase 2 Task 6)
 *   - /course-offerings      (Phase 2 Task 6)
 *   - /schedule-runs         (Phase 3)
 *   - /ready                 (Phase 2 Task 9)
 */
export function createV1Router(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  return router;
}
