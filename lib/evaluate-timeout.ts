/** Vercel / Next.js max duration for POST /api/audit/evaluate (seconds). */
export const EVALUATE_MAX_DURATION_SECONDS = 60;

export const EVALUATE_TIMEOUT_CLIENT_MESSAGE =
  'Audit timed out. Retry the evaluation. If this keeps happening, shorten the diff or try again.';

export function isEvaluateTimeoutError(error: unknown): boolean {
  if (error == null) return false;
  const err = error as { message?: string; code?: string; name?: string; status?: number; cause?: unknown };
  const haystack = [err.message, err.code, err.name, String(err.status ?? '')]
    .filter(Boolean)
    .join(' ');
  if (/timeout|timed out|ETIMEDOUT|DEADLINE|TimeoutError|UND_ERR_CONNECT_TIMEOUT/i.test(haystack)) {
    return true;
  }
  if (err.cause) return isEvaluateTimeoutError(err.cause);
  return false;
}

export function evaluateFailurePayload(error: unknown): {
  status: number;
  body: { error: string; retry?: boolean; timedOut?: boolean };
} {
  if (isEvaluateTimeoutError(error)) {
    return {
      status: 504,
      body: {
        error: EVALUATE_TIMEOUT_CLIENT_MESSAGE,
        retry: true,
        timedOut: true,
      },
    };
  }
  return {
    status: 500,
    body: {
      error:
        error instanceof Error ? error.message : 'Evaluation failed. Please verify GEMINI_API_KEY.',
    },
  };
}
