/**
 * Auth primitives: password hashing, JWT signing/verifying, opaque refresh
 * tokens. All transport- and storage-agnostic — handlers under
 * `../routes/auth.ts` compose these with the repo facades in `src/repo/`.
 *
 * Spec references:
 *   - api_design §4.1 (HS256 JWT + bcrypt-12 + opaque refresh)
 *   - api_design §4.2 (token storage: Bearer + httpOnly cookie)
 *   - api_design §4.3 (auth flow)
 *   - api_design §4.4 (password policy enforced upstream by Zod)
 *
 * Required environment variables:
 *   - `JWT_SECRET` (required at signing time): HS256 symmetric key. Module
 *     reads it lazily so dev/test code that never signs a token doesn't need
 *     it set; production server start will fail-fast on the first sign.
 */

import bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';

// ─── Constants ────────────────────────────────────────────────────────────

const BCRYPT_COST = 12;

// 15-minute access token (api_design §4.1, OQ-6).
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
// 7-day refresh token (api_design §4.1, OQ-6).
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const JWT_ISSUER = 'ga-scheduler-v2';
const JWT_AUDIENCE = 'api';

// ─── Password ────────────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ─── JWT (access token) ──────────────────────────────────────────────────

export type AuthRole = 'admin' | 'user';

export interface AccessTokenClaims {
  id: number;
  role: AuthRole;
  email: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error(
      'JWT_SECRET is not set. Configure it in the environment before signing or verifying access tokens.',
    );
  }
  return secret;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  const secret = getJwtSecret();
  const payload = {
    sub: String(claims.id),
    email: claims.email,
    role: claims.role,
  };
  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  };
  return jwt.sign(payload, secret, options);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const secret = getJwtSecret();
  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as JwtPayload | string;

  if (typeof decoded === 'string' || decoded === null) {
    throw new Error('Malformed access token payload');
  }
  const sub = decoded.sub;
  const email = (decoded as { email?: unknown }).email;
  const role = (decoded as { role?: unknown }).role;
  if (typeof sub !== 'string' || typeof email !== 'string' || (role !== 'admin' && role !== 'user')) {
    throw new Error('Malformed access token claims');
  }
  const id = Number.parseInt(sub, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Malformed access token subject');
  }
  return { id, email, role };
}

// ─── Opaque refresh token ────────────────────────────────────────────────

export interface MintedRefreshToken {
  token: string; // base64url, given to the client (never logged)
  tokenHash: string; // sha256 hex, stored in DB
  expiresAt: Date; // now + 7d
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function mintRefreshToken(): MintedRefreshToken {
  // 32 bytes → 256 bits of entropy, base64url-encoded for cookie safety.
  const raw = randomBytes(32);
  // Node 18+ supports the 'base64url' encoding directly.
  const token = raw.toString('base64url');
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  return { token, tokenHash, expiresAt };
}
