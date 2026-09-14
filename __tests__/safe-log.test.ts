import { describe, it, expect, vi } from 'vitest';
import { logger, redact, logRouteError, getRequestId } from '@/lib/safe-log';

function capture(level: 'info' | 'warn' | 'error' | 'debug') {
  const spy = vi.fn();
  const orig = console[level];
  console[level] = spy;
  return {
    spy,
    restore: () => {
      console[level] = orig;
    },
  };
}

function parseCall(spy: ReturnType<typeof capture>) {
  expect(spy.spy).toHaveBeenCalledTimes(1);
  return JSON.parse(String(spy.spy.mock.calls[0][0]));
}

describe('structured logger JSON format', () => {
  it('emits standard metadata fields for info', () => {
    const c = capture('info');
    try {
      logger.info('hello', { route: '/api/x', method: 'POST', requestId: 'abc' });
      const entry = parseCall(c);
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('hello');
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(entry.route).toBe('/api/x');
      expect(entry.method).toBe('POST');
      expect(entry.requestId).toBe('abc');
    } finally {
      c.restore();
    }
  });

  it('emits warn and error levels', () => {
    const w = capture('warn');
    try {
      logger.warn('careful');
      expect(parseCall(w).level).toBe('warn');
    } finally {
      w.restore();
    }
    const e = capture('error');
    try {
      logger.error('boom');
      const entry = parseCall(e);
      expect(entry.level).toBe('error');
      expect(entry.message).toBe('boom');
    } finally {
      e.restore();
    }
  });

  it('strips route/method/requestId from nested context', () => {
    const c = capture('info');
    try {
      logger.info('done', { route: '/api/x', method: 'GET', requestId: 'r1', extra: 'val' });
      const entry = parseCall(c);
      expect(entry.route).toBe('/api/x');
      expect(entry.method).toBe('GET');
      expect(entry.requestId).toBe('r1');
      expect(entry.context).toEqual({ extra: 'val' });
    } finally {
      c.restore();
    }
  });
});

describe('recursive redaction', () => {
  it('redacts sensitive headers recursively', () => {
    const out = redact({
      authorization: 'Bearer secret-token',
      'set-cookie': 'a=1',
      nested: { 'x-jules-api-key': 'k1', list: [{ token: 't1' }] },
    }) as any;
    expect(out.authorization).toBe('[REDACTED]');
    expect(out['set-cookie']).toBe('[REDACTED]');
    expect(out.nested['x-jules-api-key']).toBe('[REDACTED]');
    expect(out.nested.list[0].token).toBe('[REDACTED]');
  });

  it('redacts secret keys and passwords', () => {
    const out = redact({ apiKey: 'a', password: 'p', privateKey: 'k', vault: { ciphertext: 'c' }, secret: 's' }) as any;
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.privateKey).toBe('[REDACTED]');
    expect(out.vault).toBe('[REDACTED]');
    expect(out.secret).toBe('[REDACTED]');
  });

  it('masks embedded token patterns in error strings', () => {
    const out = redact(
      'key=AIzaSyABC123DEF456GHI789JKL012MNO345PQR678 and ghp_' + 'a'.repeat(36)
    ) as string;
    expect(out).toContain('[REDACTED]');
    expect(out).not.toMatch(/AIzaSyABC/);
    expect(out).not.toMatch(/ghp_/);
  });

  it('summarizes large diff/file/prompt payloads instead of dumping', () => {
    const big = 'x'.repeat(2000);
    const out = redact({ diff: big, fileContents: big, prompt: big, small: big.slice(0, 10) }) as any;
    expect(out.diff).toEqual({ diffLength: 2000, status: 'redacted' });
    expect(out.fileContents).toEqual({ contentLength: 2000, status: 'redacted' });
    expect(out.prompt).toEqual({ promptLength: 2000, status: 'redacted' });
    expect(out.small).toBe('x'.repeat(10));
  });

  it('never leaks credentials through logger context', () => {
    const c = capture('error');
    try {
      logger.error('failed', {
        route: '/api/vault',
        method: 'POST',
        requestId: 'r',
        authorization: 'Bearer sk-live-123',
        body: { apiKey: 'secret', token: 't' },
      });
      const logged = String(c.spy.mock.calls[0][0]);
      expect(logged).not.toMatch(/sk-live/);
      expect(logged).not.toMatch(/secret/);
      expect(logged).not.toMatch(/Bearer/);
      expect(logged).toContain('[REDACTED]');
    } finally {
      c.restore();
    }
  });
});

describe('logRouteError', () => {
  it('logs typed error metadata without stack trace or token patterns', () => {
    const c = capture('error');
    try {
      logRouteError('/api/x', new Error('boom ghp_' + 'a'.repeat(36)));
      const entry = parseCall(c);
      expect(entry.route).toBe('/api/x');
      expect(entry.message).not.toMatch(/ghp_/);
      expect(entry.context.error.name).toBe('Error');
      expect(entry.context.error.message).not.toMatch(/ghp_/);
      expect(entry.context.error.stack).toBeUndefined();
    } finally {
      c.restore();
    }
  });

  it('handles non-Error unknowns', () => {
    const c = capture('error');
    try {
      logRouteError('/api/x', 'string failure');
      expect(c.spy).toHaveBeenCalled();
    } finally {
      c.restore();
    }
  });
});

describe('getRequestId', () => {
  it('uses inbound x-request-id when present', () => {
    const req = new Request('http://localhost', { headers: { 'x-request-id': 'custom-id' } });
    expect(getRequestId(req)).toBe('custom-id');
  });

  it('generates a UUID when absent', () => {
    const req = new Request('http://localhost');
    const id = getRequestId(req);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});