/**
 * Shared OpenAPI components: the error envelope schema (referenced by every
 * error response in `paths.ts`) and the bearer-auth security scheme.
 *
 * Keep this module side-effect-free aside from the explicit `register*`
 * functions — `registry.ts` decides when to call them so each
 * `buildOpenApiDocument()` call gets a fresh, isolated registry.
 */

// MUST be the first import — extends zod with `.openapi(...)`. Without this
// the `errorEnvelopeSchema.openapi(...)` call below throws at module load.
import './zod-init';

import { z } from 'zod';
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

/**
 * The runtime error envelope produced by `src/api/middleware/errorHandler.ts`.
 * Mirrors the shape exactly:
 *   { error: { code: string, message: string, details?: unknown } }
 */
export const errorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi('ErrorEnvelope', {
    description:
      'Standard error envelope. `code` is a machine-readable error identifier; `details` is reserved for validation issue lists and other structured payloads.',
  });

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/** Reference to the registered ErrorEnvelope component, used by every error response. */
export const errorEnvelopeRef = {
  $ref: '#/components/schemas/ErrorEnvelope',
} as const;

/**
 * The set of error responses the central error handler can produce. Routes pick
 * the subset they actually return; every route includes 400 + 500 at minimum.
 */
export const errorResponses = {
  400: {
    description: 'Validation failure (`code: VALIDATION_FAILED`).',
    content: { 'application/json': { schema: errorEnvelopeRef } },
  },
  401: {
    description:
      'Authentication required or refresh token invalid (`code: UNAUTHORIZED | INVALID_CREDENTIALS | REFRESH_TOKEN_INVALID`).',
    content: { 'application/json': { schema: errorEnvelopeRef } },
  },
  403: {
    description:
      'Authorization failure (`code: FORBIDDEN | ACCOUNT_DISABLED | SELF_DEMOTION_FORBIDDEN | SELF_DEACTIVATION_FORBIDDEN`).',
    content: { 'application/json': { schema: errorEnvelopeRef } },
  },
  404: {
    description: 'Resource not found (`code: NOT_FOUND`).',
    content: { 'application/json': { schema: errorEnvelopeRef } },
  },
  409: {
    description:
      'Conflict (concrete codes per resource — e.g. `EMAIL_ALREADY_USED`, `SEMESTER_CODE_TAKEN`, `ROOM_NAME_TAKEN`, `SEMESTER_HAS_RELATED_ROWS`, `ROOM_REFERENCED`, `ALREADY_DEACTIVATED`, `IDEMPOTENCY_CONFLICT`).',
    content: { 'application/json': { schema: errorEnvelopeRef } },
  },
  422: {
    description:
      'Domain error (concrete codes per workflow — e.g. `SSA_INFEASIBLE`, `PRE_GA_EMPTY`, `NO_FEASIBLE_CANDIDATES`, `COMPETENCY_MISMATCH`).',
    content: { 'application/json': { schema: errorEnvelopeRef } },
  },
  500: {
    description: 'Unexpected server error (`code: INTERNAL_ERROR`).',
    content: { 'application/json': { schema: errorEnvelopeRef } },
  },
} as const;

export type ErrorResponseStatus = keyof typeof errorResponses;

/**
 * Pick a subset of error responses by status code. Always includes 400 and 500
 * by convention so callers don't have to remember to add them everywhere.
 */
export function pickErrorResponses(...codes: ErrorResponseStatus[]): Record<string, (typeof errorResponses)[ErrorResponseStatus]> {
  const merged = new Set<ErrorResponseStatus>([400, 500, ...codes]);
  const out: Record<string, (typeof errorResponses)[ErrorResponseStatus]> = {};
  for (const code of merged) {
    out[String(code)] = errorResponses[code];
  }
  return out;
}

/**
 * Register the shared components on the supplied registry. Caller controls
 * timing so the registry always starts clean.
 */
export function registerSharedComponents(registry: OpenAPIRegistry): void {
  // Schemas
  registry.register('ErrorEnvelope', errorEnvelopeSchema);

  // Security schemes
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'HS256 JWT access token issued by `POST /auth/login`. Refresh tokens travel in an HttpOnly cookie and are not visible to clients.',
  });
}

/** Standard `security` clause that every protected route should include. */
export const bearerSecurity = [{ bearerAuth: [] as string[] }];
