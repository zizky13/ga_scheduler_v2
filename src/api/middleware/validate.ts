import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { ValidationError, type ValidationIssue } from '../errors';

export interface ValidateSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

function normalizePath(path: ReadonlyArray<PropertyKey>): (string | number)[] {
  return path.map((segment) => (typeof segment === 'symbol' ? segment.toString() : segment));
}

function toApiIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: normalizePath(issue.path),
    message: issue.message,
    code: issue.code,
  }));
}

function assignReqField(req: Request, field: 'body' | 'params' | 'query', value: unknown): void {
  if (field === 'query') {
    Object.defineProperty(req, 'query', {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
    return;
  }
  (req as unknown as Record<string, unknown>)[field] = value;
}

export function validate(schemas: ValidateSchemas): RequestHandler {
  const { body, params, query } = schemas;
  return function validateMiddleware(req: Request, _res: Response, next: NextFunction): void {
    const issues: ValidationIssue[] = [];

    if (body) {
      const result = body.safeParse(req.body);
      if (!result.success) {
        issues.push(...toApiIssues(result.error));
      } else {
        assignReqField(req, 'body', result.data);
      }
    }

    if (params) {
      const result = params.safeParse(req.params);
      if (!result.success) {
        issues.push(
          ...toApiIssues(result.error).map((issue) => ({
            ...issue,
            path: ['params', ...issue.path],
          })),
        );
      } else {
        assignReqField(req, 'params', result.data);
      }
    }

    if (query) {
      const result = query.safeParse(req.query);
      if (!result.success) {
        issues.push(
          ...toApiIssues(result.error).map((issue) => ({
            ...issue,
            path: ['query', ...issue.path],
          })),
        );
      } else {
        assignReqField(req, 'query', result.data);
      }
    }

    if (issues.length > 0) {
      next(new ValidationError('Request failed schema validation', issues));
      return;
    }
    next();
  };
}
