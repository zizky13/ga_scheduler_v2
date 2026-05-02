import type { RequestHandler } from 'express';
import { NotImplementedError } from '../errors';

export function notImplemented(routeName: string): RequestHandler {
  return function notImplementedHandler(_req, _res, next) {
    next(new NotImplementedError(routeName));
  };
}
