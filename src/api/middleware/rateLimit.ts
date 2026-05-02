/**
 * Rate-limit middleware (api_design §4.4 / §4.6 / §5.3.8, techspec §7.1).
 *
 *   - `rateLimitAuth` — 5 / 15 min per IP on `/auth/login` (api_design §4.4).
 *   - `rateLimitRun` — 5 / 5 min per `req.user.id` on `POST /schedule-runs`
 *     (techspec §7.1, api_design §5.3.8).
 *
 * Storage is an in-process Map for the thesis build; Phase 3 introduces Redis
 * and can replace `InMemoryWindowStore` with a Redis-backed implementation
 * via the `store` factory argument without changing call sites.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AuthError, RateLimitError } from '../errors';

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the next request would be allowed, when `allowed=false`. */
  retryAfterSec: number;
}

export interface RateLimitStore {
  /**
   * Record an attempt for `key` at the given timestamp under a sliding window
   * of `windowMs`. Returns whether the attempt fits within `max` attempts and,
   * if not, how long the caller should wait before the oldest in-window
   * attempt expires.
   */
  hit(key: string, now: number, windowMs: number, max: number): RateLimitDecision;
}

/**
 * Sliding-window log keyed by string. Each key holds the timestamps of the
 * most recent in-window attempts; older entries are evicted on access.
 *
 * In-process only — fine for a single-node thesis deployment. Phase 3 will
 * swap this for a Redis ZSet-backed store keyed identically.
 */
export class InMemoryWindowStore implements RateLimitStore {
  private readonly buckets = new Map<string, number[]>();

  public hit(key: string, now: number, windowMs: number, max: number): RateLimitDecision {
    const cutoff = now - windowMs;
    const bucket = this.buckets.get(key) ?? [];
    // Drop expired timestamps from the head of the bucket.
    let firstFresh = 0;
    while (firstFresh < bucket.length && bucket[firstFresh]! <= cutoff) {
      firstFresh += 1;
    }
    const fresh = firstFresh === 0 ? bucket : bucket.slice(firstFresh);

    if (fresh.length >= max) {
      // The oldest in-window hit is fresh[0]; we must wait until it ages out.
      const retryAfterMs = Math.max(0, fresh[0]! + windowMs - now);
      this.buckets.set(key, fresh);
      return { allowed: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) || 1 };
    }

    fresh.push(now);
    this.buckets.set(key, fresh);
    return { allowed: true, retryAfterSec: 0 };
  }

  /** Test helper: clear all state. Not exported on the interface. */
  public reset(): void {
    this.buckets.clear();
  }
}

export type KeyExtractor = (req: Request) => string | undefined;

export interface RateLimitOptions {
  /** Maximum allowed hits per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Extracts the bucket key from a request. */
  keyOf: KeyExtractor;
  /** Pluggable store; defaults to a fresh in-memory sliding-window log. */
  store?: RateLimitStore;
  /** Clock injection for deterministic tests. */
  now?: () => number;
  /**
   * Optional 401 fallback when the key is unavailable. Callers that mount the
   * limiter behind `requireAuth` should leave this off; auth limiters that
   * key by IP set this to `false` so an absent IP reads as "deny" never.
   */
  failOnMissingKey?: boolean;
}

/**
 * Generic factory. Prefer the named helpers below at call sites.
 */
export function createRateLimit(options: RateLimitOptions): RequestHandler {
  const store = options.store ?? new InMemoryWindowStore();
  const now = options.now ?? Date.now;
  const failOnMissingKey = options.failOnMissingKey ?? false;

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = options.keyOf(req);
    if (!key) {
      if (failOnMissingKey) {
        next(new AuthError('UNAUTHORIZED', 'Authentication required'));
        return;
      }
      next();
      return;
    }
    const decision = store.hit(key, now(), options.windowMs, options.max);
    if (decision.allowed) {
      next();
      return;
    }
    res.setHeader('Retry-After', String(decision.retryAfterSec));
    next(
      new RateLimitError('Too many requests', {
        retryAfterSec: decision.retryAfterSec,
      }),
    );
  };
}

export interface AuthRateLimitOptions {
  max?: number;
  windowMs?: number;
  store?: RateLimitStore;
  now?: () => number;
}

/**
 * `/auth/login` limiter — 5 attempts / 15 min per IP per api_design §4.4.
 * Falls back to `unknown-ip` so a misconfigured proxy doesn't accidentally
 * disable the limiter.
 */
export function rateLimitAuth(options: AuthRateLimitOptions = {}): RequestHandler {
  return createRateLimit({
    max: options.max ?? 5,
    windowMs: options.windowMs ?? 15 * 60 * 1000,
    keyOf: (req) => `auth:${req.ip ?? 'unknown-ip'}`,
    ...(options.store ? { store: options.store } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}

export interface RunRateLimitOptions {
  max?: number;
  windowMs?: number;
  store?: RateLimitStore;
  now?: () => number;
}

/**
 * `POST /schedule-runs` limiter — 5 runs / 5 min per `req.user.id` per
 * techspec §7.1 / api_design §5.3.8. Must run after `requireAuth`; if
 * `req.user` is missing the limiter responds 401 rather than silently
 * letting the request through unkeyed.
 */
export function rateLimitRun(options: RunRateLimitOptions = {}): RequestHandler {
  return createRateLimit({
    max: options.max ?? 5,
    windowMs: options.windowMs ?? 5 * 60 * 1000,
    keyOf: (req) => (req.user ? `run:${req.user.id}` : undefined),
    failOnMissingKey: true,
    ...(options.store ? { store: options.store } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}
