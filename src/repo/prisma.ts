/**
 * Single shared PrismaClient instance.
 *
 * Other repository modules (`./userRepo.ts`, `./refreshTokenRepo.ts`,
 * `./scheduleRepo.ts` once it switches off injection) and the API/worker entry
 * points should import `getPrisma()` from here instead of constructing their
 * own client. Multiple `PrismaClient` instances in the same process exhaust
 * the database connection pool quickly (one pool per client).
 *
 * Tests that don't need a live database should NOT import this module — keep
 * Prisma access behind a thin repo seam so unit tests can stub it.
 */

import { PrismaClient } from '@prisma/client';

let cached: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!cached) {
    cached = new PrismaClient();
  }
  return cached;
}

/**
 * Test-only: replace the cached client. Lets integration tests inject a client
 * pointed at a sandbox database without leaking that wiring into production
 * code paths.
 */
export function setPrismaForTests(client: PrismaClient | undefined): void {
  cached = client;
}
