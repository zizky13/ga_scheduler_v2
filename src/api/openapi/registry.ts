/**
 * OpenAPI registry + document builder.
 *
 * The zod `.openapi(...)` augmentation is installed by `./zod-init` (imported
 * first in every module under `openapi/`). Once that side-effect is in place,
 * every call to `buildOpenApiDocument()` constructs a fresh registry — cheap
 * (microseconds) and isolated, so tests can observe a clean state.
 */

// MUST stay first — installs the `.openapi(...)` augmentation on zod.
import './zod-init';

import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { registerSharedComponents } from './components';
import { registerPaths } from './paths';

// ─── Package version ──────────────────────────────────────────────────────

let cachedVersion: string | null = null;
function readPackageVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    // `__dirname` is `src/api/openapi` at runtime (compiled or via tsx).
    const pkgPath = resolve(__dirname, '..', '..', '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    cachedVersion = typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

// ─── Document builder ─────────────────────────────────────────────────────

export interface BuildOptions {
  /** Override the version string (mainly for tests). */
  version?: string;
}

/**
 * Build a fresh OpenAPI v3.0 document. Each call constructs an isolated
 * `OpenAPIRegistry` and walks the path registrations again — this is cheap
 * (microseconds) and lets tests observe a clean state without cache pollution.
 *
 * Production callers should prefer `getOpenApiDocument()` which caches the
 * result for the lifetime of the process.
 */
export function buildOpenApiDocument(options: BuildOptions = {}): ReturnType<OpenApiGeneratorV3['generateDocument']> {
  const registry = new OpenAPIRegistry();
  registerSharedComponents(registry);
  registerPaths(registry);

  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'UPJ GA Scheduler API',
      version: options.version ?? readPackageVersion(),
      description:
        'REST API for the UPJ Genetic Algorithm course scheduler. See `docs/api_and_database_design.md` for full design rationale.',
    },
    servers: [{ url: '/api/v1', description: 'v1' }],
  });
}

// Cache the production document so the route handler is O(1) per request. The
// build is deterministic given the schemas + paths, so a single warm copy is
// safe for the lifetime of the Node process.
let cachedDocument: ReturnType<typeof buildOpenApiDocument> | null = null;

export function getOpenApiDocument(): ReturnType<typeof buildOpenApiDocument> {
  if (cachedDocument === null) {
    cachedDocument = buildOpenApiDocument();
  }
  return cachedDocument;
}

/** Test hook: drop the cached document so the next call rebuilds. */
export function resetOpenApiCache(): void {
  cachedDocument = null;
}
