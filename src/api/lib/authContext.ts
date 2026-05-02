/**
 * Lightweight DI seam so the `/auth/*` route module can be used in two
 * environments:
 *
 *  - Production / dev: lazy `getPrisma()` builds a singleton client and the
 *    real repositories wrap it. The first request triggers `PrismaClient`
 *    construction; processes that never hit `/auth/*` never pay the
 *    connection cost.
 *  - Tests: `setAuthRepositoriesForTests({ ... })` replaces both repos with
 *    in-memory fakes. The auth route handlers don't import Prisma at all;
 *    they go through this resolver.
 *
 * Keep this file boring: no business logic, just wiring.
 */

import type { UserRepository } from '../../repo/userRepo';
import type { RefreshTokenRepository } from '../../repo/refreshTokenRepo';
import { createUserRepository } from '../../repo/userRepo';
import { createRefreshTokenRepository } from '../../repo/refreshTokenRepo';
import { getPrisma } from '../../repo/prisma';

export interface AuthRepositories {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
}

let cached: AuthRepositories | undefined;
let override: AuthRepositories | undefined;

export function getAuthRepositories(): AuthRepositories {
  if (override) return override;
  if (!cached) {
    const prisma = getPrisma();
    cached = {
      users: createUserRepository(prisma),
      refreshTokens: createRefreshTokenRepository(prisma),
    };
  }
  return cached;
}

/**
 * Test-only: install in-memory or sandboxed repositories. Pass `undefined` to
 * fall back to the cached production wiring.
 */
export function setAuthRepositoriesForTests(
  repos: AuthRepositories | undefined,
): void {
  override = repos;
}
