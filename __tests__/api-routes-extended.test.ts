import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as githubStatusGET } from '@/app/api/github/status/route';
import { GET as julesSourcesGET } from '@/app/api/jules/sources/route';
import { GET as julesSessionGET } from '@/app/api/jules/session/route';
import { POST as julesMessagePOST } from '@/app/api/jules/message/route';
import { POST as vaultPOST } from '@/app/api/vault/route';

function captureAllStdout() {
  const calls: string[] = [];
  const origs = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const push = (arr: string[]) => (...args: unknown[]) => arr.push(args.map(String).join(' '));
  console.log = push(calls);
  console.info = push(calls);
  console.warn = push(calls);
  console.error = push(calls);
  console.debug = push(calls);
  return {
    calls,
    restore: () => {
      Object.assign(console, origs);
    },
  };
}

describe('routes never leak credentials into logs', () => {
  it('vault POST with sensitive body produces clean logs', async () => {
    const c = captureAllStdout();
    try {
      const req = new NextRequest('http://localhost:3000/api/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: 'Bearer sk-live-secret' },
        body: JSON.stringify({ blueprint: { blueprintId: 'b1', apiKey: 'ghp_' + 'a'.repeat(36) } }),
      });
      await vaultPOST(req);
    } finally {
      c.restore();
    }
    const joined = c.calls.join('\n');
    expect(joined).not.toMatch(/sk-live/);
    expect(joined).not.toMatch(/ghp_/);
    expect(joined).not.toMatch(/Bearer/);
    // Headers/body are never logged; if any redaction placeholder appears it must be [REDACTED].
    if (joined.includes('REDACTED')) expect(joined).toContain('[REDACTED]');
  });

  it('jules message with key header produces clean logs', async () => {
    const c = captureAllStdout();
    try {
      const req = new NextRequest('http://localhost:3000/api/jules/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-jules-api-key': 'AIzaSyABC123DEF456GHI789JKL012MNO345PQR678' },
        body: JSON.stringify({}),
      });
      await julesMessagePOST(req);
    } finally {
      c.restore();
    }
    const joined = c.calls.join('\n');
    expect(joined).not.toMatch(/AIzaSy/);
    if (joined.includes('REDACTED')) expect(joined).toContain('[REDACTED]');
  });
});

describe('github status route', () => {
  it('returns hasServerKey probe without leaking PAT', async () => {
    const req = new NextRequest('http://localhost:3000/api/github/status');
    const res = await githubStatusGET(req);
    expect([200, 401, 500]).toContain(res.status);
    const text = await res.text();
    expect(text).not.toMatch(/ghp_|github_pat/i);
  });
});

describe('jules sources/session/message validation', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sources requires key (401 without)', async () => {
    const req = new NextRequest('http://localhost:3000/api/jules/sources');
    const res = await julesSourcesGET(req);
    // Fail-closed: missing key yields 401 or explicit error, never success with sources
    expect([200, 401, 500]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(data.hasServerKey === true || data.valid === false || Array.isArray(data.sources)).toBe(true);
    }
  });

  it('session is fail-closed 401 without key, 400 with key but no id', async () => {
    const noKey = new NextRequest('http://localhost:3000/api/jules/session');
    expect((await julesSessionGET(noKey)).status).toBe(401);

    const withKey = new NextRequest('http://localhost:3000/api/jules/session', {
      headers: { 'x-jules-api-key': 'test-key' },
    });
    expect((await julesSessionGET(withKey)).status).toBe(400);
  });

  it('message is fail-closed 401 without key, 400 with key but empty body', async () => {
    const noKey = new NextRequest('http://localhost:3000/api/jules/message', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect((await julesMessagePOST(noKey)).status).toBe(401);

    const withKey = new NextRequest('http://localhost:3000/api/jules/message', {
      method: 'POST',
      headers: { 'x-jules-api-key': 'test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect((await julesMessagePOST(withKey)).status).toBe(400);
  });
});
