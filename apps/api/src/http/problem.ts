import { ERROR_CATALOG, type ErrorCode, type FieldError, problem } from '@bursar/schemas';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { AppEnv } from '../types';

/** Throw this from a handler and the client gets `application/problem+json` for the code. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;
  readonly errors: FieldError[] | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: ErrorCode,
    extras: { detail?: string; errors?: FieldError[]; retryAfterSeconds?: number } = {},
  ) {
    super(ERROR_CATALOG[code].title);
    this.name = 'ApiError';
    this.code = code;
    this.detail = extras.detail;
    this.errors = extras.errors;
    this.retryAfterSeconds = extras.retryAfterSeconds;
  }
}

export function fieldErrors(error: ZodError): FieldError[] {
  return error.issues.slice(0, 100).map((issue) => ({
    path: issue.path.join('.') || '(body)',
    message: issue.message.slice(0, 300) || 'Invalid value',
  }));
}

function toApiError(error: unknown): ApiError | undefined {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError)
    return new ApiError('VALIDATION_FAILED', { errors: fieldErrors(error) });
  if (error instanceof HTTPException) {
    const byStatus: Record<number, ErrorCode> = {
      400: 'VALIDATION_FAILED',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
    };
    const code = byStatus[error.status];
    return code === undefined ? undefined : new ApiError(code);
  }
  return undefined;
}

/** The error response for a code, with the request id and the problem content type. */
export function problemResponse(c: Context<AppEnv>, error: ApiError): Response {
  const body = problem(error.code, {
    ...(error.detail === undefined ? {} : { detail: error.detail }),
    ...(error.errors === undefined ? {} : { errors: error.errors }),
    ...(error.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: error.retryAfterSeconds }),
    requestId: c.get('requestId'),
    instance: c.req.path,
  });
  const headers: Record<string, string> = { 'content-type': 'application/problem+json' };
  if (error.retryAfterSeconds !== undefined)
    headers['retry-after'] = String(error.retryAfterSeconds);
  return c.newResponse(JSON.stringify(body), body.status as 400, headers);
}

/** `app.onError`: known errors keep their code; anything else is a 500 that says nothing about why. */
export function handleError(error: unknown, c: Context<AppEnv>): Response {
  const known = toApiError(error);
  if (known === undefined) {
    c.get('log').error(
      { err: error instanceof Error ? error.message : 'unknown' },
      'unhandled error',
    );
  }
  return problemResponse(c, known ?? new ApiError('INTERNAL_ERROR'));
}
