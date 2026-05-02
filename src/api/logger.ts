import pino, { type Logger, type LoggerOptions } from 'pino';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.passwordHash',
  'password',
  'passwordHash',
];

export function createLogger(): Logger {
  const level = process.env.LOG_LEVEL ?? 'info';
  const options: LoggerOptions = {
    level,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
  };
  return pino(options);
}

// Lazily constructed so process.env.LOG_LEVEL set at the entry point — or by a
// test harness before the first request — is honored. Other modules that
// previously imported `rootLogger` as a constant should call getRootLogger().
let cached: Logger | undefined;
export function getRootLogger(): Logger {
  if (!cached) {
    cached = createLogger();
  }
  return cached;
}
