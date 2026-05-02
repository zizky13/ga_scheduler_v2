/**
 * Refresh-token cookie helpers.
 *
 * Spec: api_design §4.2 — `Set-Cookie: refreshToken=<opaque>; HttpOnly; Secure;
 * SameSite=Strict; Path=/api/v1/auth; Max-Age=604800`.
 *
 * `Secure` is dropped when `NODE_ENV !== 'production'` so local dev / test runs
 * over HTTP can complete the round-trip; production deployments MUST run
 * behind TLS, so the flag is forced on there.
 */

import type { CookieOptions, Response } from 'express';
import { REFRESH_TOKEN_TTL_SECONDS } from './auth';

export const REFRESH_COOKIE_NAME = 'refreshToken';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseOptions(),
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  // express's res.clearCookie matches on name + path; we pass the same
  // attributes used at set-time so browsers reliably remove the row.
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions());
}
