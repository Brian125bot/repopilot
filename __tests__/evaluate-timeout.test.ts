import { describe, it, expect } from 'vitest';
import {
  EVALUATE_MAX_DURATION_SECONDS,
  EVALUATE_TIMEOUT_CLIENT_MESSAGE,
  evaluateFailurePayload,
  isEvaluateTimeoutError,
} from '@/lib/evaluate-timeout';
import { maxDuration } from '@/app/api/audit/evaluate/route';

describe('evaluate timeout mapping', () => {
  it('exports the same maxDuration the evaluate route declares', () => {
    expect(maxDuration).toBe(EVALUATE_MAX_DURATION_SECONDS);
    expect(EVALUATE_MAX_DURATION_SECONDS).toBeGreaterThan(0);
  });

  it('maps timeout-class errors to a retryable client payload', () => {
    expect(isEvaluateTimeoutError(new Error('The operation timed out'))).toBe(true);
    const payload = evaluateFailurePayload(new Error('DeadlineExceeded'));
    expect(payload.status).toBe(504);
    expect(payload.body.retry).toBe(true);
    expect(payload.body.timedOut).toBe(true);
    expect(payload.body.error).toBe(EVALUATE_TIMEOUT_CLIENT_MESSAGE);
    expect(payload.body.error).toMatch(/retry/i);
  });

  it('does not treat ordinary failures as timeouts', () => {
    expect(isEvaluateTimeoutError(new Error('GEMINI_API_KEY is not configured'))).toBe(false);
    const payload = evaluateFailurePayload(new Error('model unavailable'));
    expect(payload.status).toBe(500);
    expect(payload.body.retry).toBeUndefined();
    expect(payload.body.error).toBe('model unavailable');
  });
});
