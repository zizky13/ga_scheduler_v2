import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Role } from '@prisma/client';

import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  loginBodySchema,
  logoutBodySchema,
  refreshBodySchema,
  registerBodySchema,
  type LoginBody,
  type RegisterBody,
} from '../schemas/auth';
import { AuthError, AuthzError, ConflictError, NotFoundError } from '../errors';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  hashPassword,
  hashRefreshToken,
  mintRefreshToken,
  signAccessToken,
  verifyPassword,
  type AuthRole,
} from '../lib/auth';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  setRefreshCookie,
} from '../lib/cookies';
import { getAuthRepositories } from '../lib/authContext';
import { writeAudit } from '../lib/audit';
import type { UserRecord } from '../../repo/userRepo';

// ─── Helpers ───────────────────────────────────────────────────────────────

function roleEnumToWire(role: Role): AuthRole {
  return role === 'ADMIN' ? 'admin' : 'user';
}

function roleWireToEnum(role: AuthRole): Role {
  return role === 'admin' ? 'ADMIN' : 'USER';
}

interface MePayload {
  id: number;
  email: string;
  fullName: string;
  role: AuthRole;
  lastLoginAt: string | null;
}

function toMePayload(user: UserRecord): MePayload {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: roleEnumToWire(user.role),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}

interface RegisterResponse {
  id: number;
  email: string;
  fullName: string;
  role: AuthRole;
  isActive: boolean;
  createdAt: string;
}

function toRegisterResponse(user: UserRecord): RegisterResponse {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: roleEnumToWire(user.role),
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  };
}

interface PrismaKnownError {
  code?: string;
  meta?: { target?: string[] | string };
}
function isPrismaUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as PrismaKnownError).code;
  return code === 'P2002';
}

function pickIp(req: Request): string | null {
  const ip = req.ip;
  if (typeof ip === 'string' && ip.length > 0) return ip;
  return null;
}
function pickUserAgent(req: Request): string | null {
  const ua = req.get('user-agent');
  return ua && ua.length > 0 ? ua : null;
}

function readRefreshCookie(req: Request): string | null {
  // cookie-parser populates req.cookies. Defensive: it may be undefined if
  // someone strips the middleware.
  const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
  if (!cookies || typeof cookies !== 'object') return null;
  const v = cookies[REFRESH_COOKIE_NAME];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ─── Handlers ──────────────────────────────────────────────────────────────

async function postRegister(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as RegisterBody;
    const repos = getAuthRepositories();
    const passwordHash = await hashPassword(body.password);
    let user: UserRecord;
    try {
      user = await repos.users.createUser({
        email: body.email,
        passwordHash,
        fullName: body.fullName,
        role: roleWireToEnum(body.role),
      });
    } catch (err) {
      if (isPrismaUniqueViolation(err)) {
        next(new ConflictError('EMAIL_ALREADY_USED', 'Email is already registered'));
        return;
      }
      throw err;
    }
    // api_design §8: `user.create` is admin-only and writes a full diff with
    // passwordHash redacted (we don't carry the hash through the helper, but
    // leaving the redactor visible documents the rule).
    await writeAudit(req, {
      action: 'user.create',
      entityType: 'User',
      entityId: String(user.id),
      metadata: {
        before: null,
        after: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          isActive: user.isActive,
          passwordHash: '[REDACTED]',
        },
      },
    });
    res.status(201).json(toRegisterResponse(user));
  } catch (err) {
    next(err);
  }
}

async function postLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as LoginBody;
    const repos = getAuthRepositories();
    const user = await repos.users.findUserByEmail(body.email);

    // Always run bcrypt against *something* to keep login latency uniform
    // whether or not the email exists. bcrypt.compare against an arbitrary
    // hash is an established mitigation for user-enumeration via timing.
    const referenceHash =
      user?.passwordHash ??
      '$2b$12$0000000000000000000000000000000000000000000000000000';
    const ok = await verifyPassword(body.password, referenceHash);
    if (!user || !ok) {
      // api_design §8: emit `auth.login_failed` with actorId=null because the
      // request is not authenticated. Run BEFORE forwarding the error so a
      // misbehaving handler later in the chain cannot drop the audit.
      await writeAudit(req, {
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user ? String(user.id) : '0',
        actorId: null,
        metadata: {
          email: body.email,
          success: false,
          ip: pickIp(req),
          userAgent: pickUserAgent(req),
        },
      });
      next(new AuthError('INVALID_CREDENTIALS', 'Invalid email or password'));
      return;
    }
    if (!user.isActive) {
      // Disabled-account login attempt is also a failure path per §8.
      await writeAudit(req, {
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: String(user.id),
        actorId: null,
        metadata: {
          email: body.email,
          success: false,
          ip: pickIp(req),
          userAgent: pickUserAgent(req),
          reason: 'ACCOUNT_DISABLED',
        },
      });
      next(new AuthzError('Account is disabled', undefined, 'ACCOUNT_DISABLED'));
      return;
    }

    const role = roleEnumToWire(user.role);
    const accessToken = signAccessToken({ id: user.id, email: user.email, role });
    const minted = mintRefreshToken();
    await repos.refreshTokens.createRefreshToken({
      userId: user.id,
      tokenHash: minted.tokenHash,
      expiresAt: minted.expiresAt,
      userAgent: pickUserAgent(req),
      ipAddress: pickIp(req),
    });

    const now = new Date();
    await repos.users.updateLastLogin(user.id, now);

    setRefreshCookie(res, minted.token);
    // api_design §8: `auth.login` row carries `{ email, success, ip, userAgent }`.
    await writeAudit(req, {
      action: 'auth.login',
      entityType: 'User',
      entityId: String(user.id),
      actorId: user.id,
      metadata: {
        email: user.email,
        success: true,
        ip: pickIp(req),
        userAgent: pickUserAgent(req),
      },
    });
    res.status(200).json({
      user: toMePayload({ ...user, lastLoginAt: now }),
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  } catch (err) {
    next(err);
  }
}

async function postRefresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cookieValue = readRefreshCookie(req);
    if (!cookieValue) {
      next(new AuthError('REFRESH_TOKEN_INVALID', 'Refresh token missing'));
      return;
    }
    const repos = getAuthRepositories();
    const tokenHash = hashRefreshToken(cookieValue);
    const row = await repos.refreshTokens.findActiveByHash(tokenHash);
    if (!row) {
      // Invalid / revoked / expired — clear any stale cookie before responding.
      clearRefreshCookie(res);
      next(new AuthError('REFRESH_TOKEN_INVALID', 'Refresh token invalid or expired'));
      return;
    }

    const user = await repos.users.findUserById(row.userId);
    if (!user || !user.isActive) {
      // Defense in depth: a deactivated user must not be able to refresh.
      // Revoke the row so a re-activation later doesn't replay an old token.
      await repos.refreshTokens.revokeById(row.id);
      clearRefreshCookie(res);
      next(new AuthError('REFRESH_TOKEN_INVALID', 'Refresh token invalid'));
      return;
    }

    // Single-use rotation: revoke the old row, then mint a new one.
    await repos.refreshTokens.revokeById(row.id);
    const minted = mintRefreshToken();
    await repos.refreshTokens.createRefreshToken({
      userId: user.id,
      tokenHash: minted.tokenHash,
      expiresAt: minted.expiresAt,
      userAgent: pickUserAgent(req),
      ipAddress: pickIp(req),
    });

    const role = roleEnumToWire(user.role);
    const accessToken = signAccessToken({ id: user.id, email: user.email, role });
    setRefreshCookie(res, minted.token);
    res.status(200).json({ accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  } catch (err) {
    next(err);
  }
}

async function postLogout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cookieValue = readRefreshCookie(req);
    let revokedTokenId: string | null = null;
    if (cookieValue) {
      const repos = getAuthRepositories();
      const tokenHash = hashRefreshToken(cookieValue);
      // Best-effort revocation: even if the row is missing or already revoked,
      // logout is idempotent and still returns 204.
      const row = await repos.refreshTokens.findActiveByHash(tokenHash);
      if (row) {
        await repos.refreshTokens.revokeById(row.id);
        revokedTokenId = row.id;
      }
    }
    clearRefreshCookie(res);
    // api_design §8: `auth.logout` carries `{ tokenId }`. If we didn't find a
    // row to revoke (already logged out / no cookie), omit the field — do not
    // invent one.
    const metadata: Record<string, unknown> = {};
    if (revokedTokenId !== null) metadata.tokenId = revokedTokenId;
    await writeAudit(req, {
      action: 'auth.logout',
      entityType: 'User',
      entityId: req.user ? String(req.user.id) : '0',
      metadata,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(new AuthError('UNAUTHORIZED', 'Authentication required'));
      return;
    }
    const repos = getAuthRepositories();
    const user = await repos.users.findUserById(req.user.id);
    if (!user) {
      next(new NotFoundError('User not found'));
      return;
    }
    res.status(200).json(toMePayload(user));
  } catch (err) {
    next(err);
  }
}

// ─── Router ────────────────────────────────────────────────────────────────

export function createAuthRouter(): Router {
  const router = Router();

  router.post(
    '/register',
    requireAuth(),
    requireRole('admin'),
    validate({ body: registerBodySchema }),
    postRegister,
  );

  // TODO Task 4: rateLimitAuth
  router.post('/login', validate({ body: loginBodySchema }), postLogin);

  router.post('/refresh', validate({ body: refreshBodySchema }), postRefresh);

  router.post('/logout', requireAuth(), validate({ body: logoutBodySchema }), postLogout);

  router.get('/me', requireAuth(), getMe);

  return router;
}
