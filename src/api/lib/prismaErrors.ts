/**
 * Narrow helpers for the Prisma error codes route handlers actually inspect.
 *
 * Keeping the duck-typing in one place lets routes avoid pulling in
 * `Prisma.PrismaClientKnownRequestError` (which would force a runtime Prisma
 * import), and keeps the test surface small — fakes can throw an `Error` with
 * a `code` property and the route layer reacts identically.
 */

interface PrismaKnownError {
  code?: string;
  meta?: { target?: string[] | string };
}

function asPrismaError(err: unknown): PrismaKnownError | null {
  if (typeof err !== 'object' || err === null) return null;
  return err as PrismaKnownError;
}

/** Prisma `P2002` — unique constraint violation. */
export function isPrismaUniqueViolation(err: unknown): boolean {
  return asPrismaError(err)?.code === 'P2002';
}

/** Prisma `P2025` — record not found (raised by `update` / `delete` of a
 * missing row). */
export function isPrismaNotFound(err: unknown): boolean {
  return asPrismaError(err)?.code === 'P2025';
}

/** Prisma `P2003` — foreign-key constraint failure (e.g., missing parent
 * row referenced by `connect`). */
export function isPrismaForeignKeyError(err: unknown): boolean {
  return asPrismaError(err)?.code === 'P2003';
}
