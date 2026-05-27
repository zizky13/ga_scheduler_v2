#!/usr/bin/env node
/**
 * Snapshots the dev PostgreSQL database into the demo PostgreSQL database.
 *
 * Reads DATABASE_URL from .env (source) and .env.demo (destination), then:
 *   1. terminates open sessions on the demo DB,
 *   2. drops and recreates the demo DB,
 *   3. pipes pg_dump <dev> into psql <demo>.
 *
 * Result: demo is a bit-for-bit copy of dev — schema, data, sequences,
 * _prisma_migrations rows, users, the lot.
 *
 * Usage:  npm run db:clone:demo
 * Needs:  pg_dump and psql on PATH (any PostgreSQL client install).
 */
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function readDatabaseUrl(envFile) {
  const text = readFileSync(resolve(process.cwd(), envFile), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^DATABASE_URL\s*=\s*"?([^"]+)"?$/);
    if (m) return m[1];
  }
  throw new Error(`DATABASE_URL missing or unparseable in ${envFile}`);
}

function stripPrismaQuery(rawUrl) {
  // libpq rejects Prisma-only params like ?schema=public, so strip them.
  const u = new URL(rawUrl);
  u.search = '';
  return u.toString();
}

const devUrl = stripPrismaQuery(readDatabaseUrl('.env'));
const demoUrl = stripPrismaQuery(readDatabaseUrl('.env.demo'));

const demoParsed = new URL(demoUrl);
const demoDbName = decodeURIComponent(demoParsed.pathname.replace(/^\//, ''));
if (!demoDbName) {
  throw new Error(`Demo URL is missing a database name: ${demoUrl}`);
}

const adminParsed = new URL(demoUrl);
adminParsed.pathname = '/postgres';
const adminUrl = adminParsed.toString();

function runSync(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.error) {
    console.error(`[clone] Failed to spawn ${cmd}: ${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`[clone] ${cmd} exited with status ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

console.log(`[clone] Terminating open sessions on ${demoDbName}...`);
runSync('psql', [
  adminUrl,
  '-v',
  'ON_ERROR_STOP=1',
  '-c',
  `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${demoDbName}' AND pid <> pg_backend_pid();`,
]);

console.log(`[clone] Dropping ${demoDbName}...`);
runSync('psql', [adminUrl, '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS "${demoDbName}";`]);

console.log(`[clone] Creating ${demoDbName}...`);
runSync('psql', [adminUrl, '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${demoDbName}";`]);

console.log('[clone] Dumping dev and restoring into demo (pg_dump | psql)...');
const dump = spawn('pg_dump', [devUrl], { stdio: ['ignore', 'pipe', 'inherit'] });
const restore = spawn('psql', ['-v', 'ON_ERROR_STOP=1', demoUrl], { stdio: ['pipe', 'inherit', 'inherit'] });
dump.stdout.pipe(restore.stdin);

const [dumpExit, restoreExit] = await Promise.all([
  new Promise((res) => dump.on('exit', res)),
  new Promise((res) => restore.on('exit', res)),
]);

if (dumpExit !== 0 || restoreExit !== 0) {
  console.error(`[clone] Failed (pg_dump=${dumpExit}, psql=${restoreExit})`);
  process.exit(1);
}

console.log(`[clone] Done. ${demoDbName} now mirrors the current dev DB.`);
