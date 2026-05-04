/**
 * Audit helpers — write one `AuditLog` row from every state-changing endpoint
 * per api_design §8 (lines 1097–1114).
 *
 * Design rules:
 *   - Audit failure must NEVER surface to the caller. The DB mutation already
 *     succeeded by the time we get here; if persisting the audit row hiccups,
 *     log it via pino and move on. A 500 here would be worse than a missing
 *     audit row — the user just changed something and we'd be telling them it
 *     failed.
 *   - `requestId` rides inside `metadata` because the `AuditLog` schema has
 *     no top-level column for it (prisma/schema.prisma:437–454). The encoding
 *     is local to this helper + `auditLogRepo`.
 *   - Password hashes are redacted on every diff. We never want a bcrypt
 *     hash leaked into the audit table — it's still a credential.
 */

import type { Request } from 'express';

import { getRootLogger } from '../logger';
import { getCrudRepositories } from './crudContext';

const REDACTED = '[REDACTED]';
const PASSWORD_HASH_KEY = 'passwordHash';

/**
 * Recursively clone `value` and replace any property named `passwordHash`
 * with the literal string `'[REDACTED]'`. Returns a fresh object — does not
 * mutate the input.
 *
 * For our shapes the field only ever appears top-level on the User entity,
 * but recursing is cheap and protects against future nested embeddings (e.g.
 * an audit row that includes the actor as a sub-object).
 */
export function redactPasswordHash<T>(value: T): T {
  return redactClone(value) as T;
}

function redactClone(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(redactClone);
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = k === PASSWORD_HASH_KEY ? REDACTED : redactClone(v);
  }
  return out;
}

export interface DiffResult {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * Compute a key-level diff between two objects, returning only the keys whose
 * values changed (deep-equal compare). Both sides must be plain objects.
 *
 * Useful for `update` audit entries so the row stays small even when the
 * entity has 20 fields and only one moved.
 */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): DiffResult {
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const diffBefore: Record<string, unknown> = {};
  const diffAfter: Record<string, unknown> = {};
  for (const key of keys) {
    if (!deepEqual(before[key], after[key])) {
      diffBefore[key] = before[key];
      diffAfter[key] = after[key];
    }
  }
  return { before: diffBefore, after: diffAfter };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

export interface WriteAuditParams {
  action: string;
  entityType: string;
  entityId: string;
  /**
   * Caller-supplied metadata payload. The helper merges `requestId` from
   * `req.id` so callers don't have to remember it.
   */
  metadata?: Record<string, unknown>;
  /**
   * Optional override for the actor id. Defaults to `req.user?.id ?? null`.
   * Used by `auth.login_failed` where the request is not authenticated and
   * the audit row's actor must be `null`.
   */
  actorId?: number | null;
}

/**
 * Convenience wrapper used by every state-changing route handler. Pulls
 * `actorId`, `ipAddress`, `userAgent` from `req`, merges `requestId` into
 * `metadata`, and calls `auditLogRepo.create`.
 *
 * Audit failure must not surface to caller. We catch and log; the user-facing
 * response has already been queued by this point.
 */
export async function writeAudit(req: Request, params: WriteAuditParams): Promise<void> {
  try {
    const repos = getCrudRepositories();
    const actorId =
      params.actorId !== undefined ? params.actorId : req.user?.id ?? null;
    const ipAddress = pickIp(req);
    const userAgent = pickUserAgent(req);
    const metadata: Record<string, unknown> = {
      ...(params.metadata ?? {}),
      requestId: req.id,
    };
    await repos.auditLogs.create({
      actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata,
      ipAddress,
      userAgent,
    });
  } catch (err) {
    // audit failure must not surface to caller — log and swallow.
    getRootLogger().warn(
      { err, action: params.action, entityType: params.entityType, entityId: params.entityId },
      'audit write failed',
    );
  }
}

function pickIp(req: Request): string | null {
  const ip = req.ip;
  return typeof ip === 'string' && ip.length > 0 ? ip : null;
}

function pickUserAgent(req: Request): string | null {
  const ua = req.get('user-agent');
  return ua && ua.length > 0 ? ua : null;
}
