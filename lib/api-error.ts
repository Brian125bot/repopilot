import { NextResponse } from 'next/server';
import { logRouteError } from '@/lib/safe-log';

export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR'
  | 'REQUEST_FAILED'
  | 'TIMEOUT';

export interface ApiErrorBody {
  success: false;
  code: ApiErrorCode;
  error: string;
  message: string;
  requestId: string;
}

export interface ApiErrorOptions {
  status: number;
  code: ApiErrorCode;
  message: string;
  /** Existing route-specific fields that clients may rely on. */
  details?: Record<string, unknown>;
}

/** Generates a server-owned correlation ID; request headers are never trusted or logged. */
export function createRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Produces the stable error envelope used by every API route and writes its single
 * redacted structured log event. Never put raw request data in `details`.
 */
export function apiError(
  route: string,
  requestId: string,
  { status, code, message, details = {} }: ApiErrorOptions
): NextResponse<ApiErrorBody & Record<string, unknown>> {
  logRouteError(route, { requestId, status, code });
  return NextResponse.json(
    { ...details, success: false, code, error: message, message, requestId },
    { status, headers: { 'x-request-id': requestId } }
  );
}
