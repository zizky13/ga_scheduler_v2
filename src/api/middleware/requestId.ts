import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
  }
}

const HEADER = 'X-Request-Id';
// Allow alphanumerics, dash, underscore. Cap at 128 chars to bound log noise.
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_REQUEST_ID.test(value);
}

export function requestId(): RequestHandler {
  return function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(HEADER);
    const id = isValidRequestId(incoming) ? incoming : uuidv4();
    req.id = id;
    res.setHeader(HEADER, id);
    next();
  };
}
