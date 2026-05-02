import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError, NotFoundError } from '../errors';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

function buildEnvelope(code: string, message: string, details?: Record<string, unknown>): ErrorEnvelope {
  const envelope: ErrorEnvelope = { error: { code, message } };
  if (details !== undefined) {
    envelope.error.details = details;
  }
  return envelope;
}

export function notFoundHandler(): RequestHandler {
  return function notFound(req, _res, next) {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
  };
}

export function errorHandler(): ErrorRequestHandler {
  return function centralizedErrorHandler(
    err: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    // If a response is already on the wire, bail to Express's default handler so
    // the connection terminates instead of double-writing the body.
    if (res.headersSent) {
      next(err);
      return;
    }

    const log = req.log ?? undefined;
    const baseLogContext = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
    };

    if (err instanceof ApiError) {
      if (log) {
        const level = err.statusCode >= 500 ? 'error' : 'warn';
        log[level](
          {
            ...baseLogContext,
            err: { name: err.name, code: err.code, stack: err.stack },
            details: err.details,
          },
          `Handled ${err.name}: ${err.message}`,
        );
      }
      res.status(err.statusCode).json(buildEnvelope(err.code, err.message, err.details));
      return;
    }

    // Unknown error: log everything we know, but never leak internals downstream.
    const fallback = err instanceof Error ? err : new Error('Non-error thrown');
    if (log) {
      log.error(
        { ...baseLogContext, err: { name: fallback.name, stack: fallback.stack } },
        `Unhandled error: ${fallback.message}`,
      );
    }

    res.status(500).json(buildEnvelope('INTERNAL_ERROR', 'Internal server error'));
  };
}
