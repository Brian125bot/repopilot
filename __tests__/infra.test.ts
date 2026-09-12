import { describe, it, expect, vi } from 'vitest';
import { logRouteError } from '@/lib/safe-log';
import { cn } from '@/lib/utils';
import { evaluateFailurePayload, isEvaluateTimeoutError } from '@/lib/evaluate-timeout';

describe('safe-log never leaks credentials', () => {
  it('logs message only, even for Error objects with secrets', () => {
    const err = vi.fn();
    const orig = console.error;
    console.error = err;
    try {
      logRouteError('/api/x', new Error('boom x-jules-api-key=secret123'));
      expect(err).toHaveBeenCalledTimes(1);
      const logged = String(err.mock.calls[0][0]);
      expect(logged).toContain('/api/x');
      expect(logged).toContain('boom');
    } finally {
      console.error = orig;
    }
  });

  it('handles non-Error unknowns', () => {
    const err = vi.fn();
    const orig = console.error;
    console.error = err;
    try {
      logRouteError('/api/x', 'string failure');
      expect(err).toHaveBeenCalled();
    } finally {
      console.error = orig;
    }
  });
});

describe('cn tailwind merging', () => {
  it('merges conflicting tailwind classes, keeping last', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-red-500', { 'font-bold': true }, ['underline'])).toContain('font-bold');
  });
});

describe('evaluate-timeout helpers', () => {
  it('detects timeout errors by name/message', () => {
    expect(isEvaluateTimeoutError({ name: 'TimeoutError' })).toBe(true);
    expect(isEvaluateTimeoutError(new Error('request timed out after 60s'))).toBe(true);
    expect(isEvaluateTimeoutError(new Error('other'))).toBe(false);
  });

  it('failure payload is retryable for timeout, fatal otherwise', () => {
    const timeout = evaluateFailurePayload({ name: 'TimeoutError', message: 'timed out' });
    expect(timeout.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(timeout.body).toLowerCase()).toMatch(/timeout|retry/);
    const fatal = evaluateFailurePayload(new Error('bad key'));
    expect(fatal.status).toBeGreaterThanOrEqual(400);
  });
});
