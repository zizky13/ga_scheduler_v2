/**
 * Typed error classes consumed by the centralized error middleware.
 * Categories and status codes are defined in api_and_database_design.md §5.2 / §6.
 */

export interface ApiErrorDetails {
  [key: string]: unknown;
}

export interface ValidationIssue {
  path: (string | number)[];
  message: string;
  code?: string;
}

export abstract class ApiError extends Error {
  public abstract readonly statusCode: number;
  public readonly code: string;
  public readonly details?: ApiErrorDetails;

  protected constructor(code: string, message: string, details?: ApiErrorDetails) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
    // Preserve V8 stack trace formatting when available.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    }
  }
}

export class ValidationError extends ApiError {
  public readonly statusCode = 400;

  constructor(
    message = 'Request failed schema validation',
    issues: ValidationIssue[] = [],
    code = 'VALIDATION_FAILED',
  ) {
    super(code, message, { issues });
  }
}

export class AuthError extends ApiError {
  public readonly statusCode = 401;

  constructor(code = 'UNAUTHORIZED', message = 'Authentication required', details?: ApiErrorDetails) {
    super(code, message, details);
  }
}

export class AuthzError extends ApiError {
  public readonly statusCode = 403;

  constructor(message = 'Forbidden', details?: ApiErrorDetails, code = 'FORBIDDEN') {
    super(code, message, details);
  }
}

export class NotFoundError extends ApiError {
  public readonly statusCode = 404;

  constructor(message = 'Resource not found', details?: ApiErrorDetails, code = 'NOT_FOUND') {
    super(code, message, details);
  }
}

export class ConflictError extends ApiError {
  public readonly statusCode = 409;

  constructor(code = 'CONFLICT', message = 'Conflict', details?: ApiErrorDetails) {
    super(code, message, details);
  }
}

export class DomainError extends ApiError {
  public readonly statusCode = 422;

  constructor(code: string, message: string, details?: ApiErrorDetails) {
    super(code, message, details);
  }
}

export class NotImplementedError extends ApiError {
  public readonly statusCode = 501;

  constructor(routeName: string, details?: ApiErrorDetails) {
    super('NOT_IMPLEMENTED', `${routeName} is not implemented yet`, details);
  }
}
