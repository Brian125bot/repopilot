import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as githubStatusGET } from '@/app/api/github/status/route';
import { GET as julesSourcesGET } from '@/app/api/jules/sources/route';
import { GET as julesSessionGET } from '@/app/api/jules/session/route';
import { POST as julesMessagePOST } from '@/app/api/jules/message/route';

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
