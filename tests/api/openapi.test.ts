// Quiet pino during tests — keep parity with `tests/api/server.test.ts`.
process.env.LOG_LEVEL = 'silent';

import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { createServer } from '../../src/api/server';
import { buildOpenApiDocument } from '../../src/api/openapi/registry';

let app: Application;

beforeAll(() => {
  app = createServer();
});

describe('GET /api/v1/openapi.json', () => {
  it('responds 200 with application/json', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/u);
  });

  it('emits a Cache-Control header so the doc is browser-cacheable', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.headers['cache-control']).toMatch(/max-age=300/u);
  });

  it('returns an OpenAPI 3.x document with the expected info block', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    expect(typeof res.body.openapi).toBe('string');
    expect(res.body.openapi.startsWith('3.')).toBe(true);
    expect(res.body.info.title).toBe('UPJ GA Scheduler API');
    // version comes from package.json — must be a non-empty string.
    expect(typeof res.body.info.version).toBe('string');
    expect(res.body.info.version.length).toBeGreaterThan(0);
    // server URL is /api/v1 per the design.
    expect(res.body.servers).toEqual(
      expect.arrayContaining([expect.objectContaining({ url: '/api/v1' })]),
    );
  });

  it('exposes the auth endpoints with the expected operations', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.body.paths['/auth/login']).toBeDefined();
    expect(res.body.paths['/auth/login'].post).toBeDefined();
    expect(res.body.paths['/auth/me']).toBeDefined();
    expect(res.body.paths['/auth/me'].get).toBeDefined();
  });

  it('exposes /schedule-runs with both list and create operations', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.body.paths['/schedule-runs']).toBeDefined();
    expect(res.body.paths['/schedule-runs'].get).toBeDefined();
    expect(res.body.paths['/schedule-runs'].post).toBeDefined();
  });

  it('registers the ErrorEnvelope schema component', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.body.components.schemas.ErrorEnvelope).toBeDefined();
    expect(res.body.components.schemas.ErrorEnvelope.type).toBe('object');
    // The runtime envelope is `{ error: { code, message, details? } }`.
    const err = res.body.components.schemas.ErrorEnvelope.properties.error;
    expect(err).toBeDefined();
    expect(err.properties.code).toBeDefined();
    expect(err.properties.message).toBeDefined();
  });

  it('registers a bearerAuth security scheme', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    const scheme = res.body.components.securitySchemes.bearerAuth;
    expect(scheme).toBeDefined();
    expect(scheme.type).toBe('http');
    expect(scheme.scheme).toBe('bearer');
    expect(scheme.bearerFormat).toBe('JWT');
  });

  it('uses OpenAPI {id} syntax for path parameters (not Express :id)', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    const paths = Object.keys(res.body.paths);
    // At least one of these `{id}` paths must exist; none should leak `:id`.
    expect(paths).toEqual(expect.arrayContaining(['/users/{id}', '/rooms/{id}']));
    for (const p of paths) {
      expect(p).not.toMatch(/:[a-zA-Z]/u);
    }
  });

  it('does not require auth for the openapi route itself', async () => {
    // No Authorization header, no cookies — must still be 200.
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
  });
});

describe('buildOpenApiDocument()', () => {
  it('builds without throwing and returns a JSON-serializable object', () => {
    const doc = buildOpenApiDocument();
    expect(() => JSON.stringify(doc)).not.toThrow();
    expect(typeof doc).toBe('object');
    expect(doc).not.toBeNull();
  });

  it('produces enough paths to cover every mounted route', () => {
    const doc = buildOpenApiDocument();
    const pathCount = Object.keys(doc.paths ?? {}).length;
    // ≥ 25 is a generous floor; current implementation registers 30.
    expect(pathCount).toBeGreaterThanOrEqual(25);
  });

  it('attaches the bearer security clause to a representative protected route', () => {
    const doc = buildOpenApiDocument();
    const op = doc.paths?.['/users']?.get;
    expect(op).toBeDefined();
    expect(op?.security).toEqual(expect.arrayContaining([{ bearerAuth: [] }]));
  });

  it('documents per-session lecturerIds on schedule-run detail responses', () => {
    const doc = buildOpenApiDocument();
    const detailSchema = doc.components?.schemas?.ScheduleRunDetailResponse as {
      properties?: {
        assignments?: {
          items?: {
            properties?: {
              sessions?: {
                items?: {
                  properties?: Record<string, unknown>;
                };
              };
            };
          };
        };
      };
    };

    const sessionProps =
      detailSchema.properties?.assignments?.items?.properties?.sessions?.items?.properties;
    expect(sessionProps?.lecturerIds).toBeDefined();
  });

  it('omits security on /auth/login (publicly callable)', () => {
    const doc = buildOpenApiDocument();
    const op = doc.paths?.['/auth/login']?.post;
    expect(op).toBeDefined();
    // Either undefined or an empty array — both mean "no security".
    if (op?.security !== undefined) {
      expect(op.security).toEqual([]);
    }
  });
});
