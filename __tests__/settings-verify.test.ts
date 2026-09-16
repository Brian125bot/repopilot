import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as verifyGithub } from '@/app/api/settings/verify-github/route';
import { POST as verifyGemini } from '@/app/api/settings/verify-gemini/route';
import { POST as verifyJules } from '@/app/api/settings/verify-jules/route';
import { redactSecrets } from '@/lib/redact-secrets';

const GITHUB_KEY = 'ghp_testkey1234567890abcdefghij';
const GEMINI_KEY = 'AIzaTestGeminiKey1234567890abc';
const JULES_KEY = 'jules-test-key-abcdef1234567890';

function postReq(url: string, headers: Record<string, string>, body?: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function jsonResponse(ok: boolean, body: unknown, headers: Record<string, string> = {}, status = 200) {
  const headerMap = new Map<string, string>(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    ok,
    status,
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function errorResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return jsonResponse(false, body, headers, status);
}

function assertNoKeyMaterial(payload: string, key: string) {
  expect(payload).not.toContain(key);
  expect(payload).not.toContain(key.slice(0, 4));
  expect(payload).not.toContain(key.slice(-4));
  expect(payload).not.toContain(String(key.length));
}

describe('verify-github', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('happy path returns login, scopes, classic tokenType', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(
        true,
        { login: 'octo', name: 'Octo Cat' },
        { 'x-oauth-scopes': 'repo, gist' }
      )
    );
    const res = await verifyGithub(
      postReq('http://localhost:3000/api/settings/verify-github', { 'x-github-pat': GITHUB_KEY })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.login).toBe('octo');
    expect(data.scopes).toEqual(['repo', 'gist']);
    expect(data.tokenType).toBe('classic');
  });

  it('classic PAT with repo scope carries the broad-scope warning', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(true, { login: 'octo' }, { 'x-oauth-scopes': 'repo, read:org' })
    );
    const res = await verifyGithub(
      postReq('http://localhost:3000/api/settings/verify-github', { 'x-github-pat': GITHUB_KEY })
    );
    const data = await res.json();
    expect(data.warnings).toContain(
      'Classic PAT with broad scopes detected — fine-grained is recommended.'
    );
  });

  it('fine-grained PAT has empty scopes and fine-grained type', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(true, { login: 'octo' }, { 'x-github-token-type': 'PAT with fine-grained permissions' })
    );
    const res = await verifyGithub(
      postReq('http://localhost:3000/api/settings/verify-github', { 'x-github-pat': GITHUB_KEY })
    );
    const data = await res.json();
    expect(data.tokenType).toBe('fine-grained');
    expect(data.scopes).toEqual([]);
  });

  it('401 maps to the human rejected-token sentence with no key material', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      errorResponse(401, { message: 'Bad credentials' })
    );
    const res = await verifyGithub(
      postReq('http://localhost:3000/api/settings/verify-github', { 'x-github-pat': GITHUB_KEY })
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('GitHub rejected this token. It may be expired, revoked, or mistyped.');
    assertNoKeyMaterial(JSON.stringify(data), GITHUB_KEY);
  });

  it('403 with exhausted rate limit maps to the rate-limit sentence', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      errorResponse(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' })
    );
    const res = await verifyGithub(
      postReq('http://localhost:3000/api/settings/verify-github', { 'x-github-pat': GITHUB_KEY })
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe('GitHub rate limit hit. Wait a few minutes or use a different token.');
  });
});

describe('verify-gemini', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('happy path caps sampleModels at 10', async () => {
    const models = Array.from({ length: 14 }, (_, i) => ({ name: `models/gemini-${i}` }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse(true, { models }));
    const res = await verifyGemini(
      postReq('http://localhost:3000/api/settings/verify-gemini', { 'x-gemini-api-key': GEMINI_KEY })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.sampleModels).toHaveLength(10);
    expect(data.sampleModels[0]).toBe('models/gemini-0');
  });

  it('200 with empty models still ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse(true, { models: [] }));
    const res = await verifyGemini(
      postReq('http://localhost:3000/api/settings/verify-gemini', { 'x-gemini-api-key': GEMINI_KEY })
    );
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.sampleModels).toEqual([]);
    expect(data.emptyModelsNotice).toContain('Generative Language API is enabled');
  });

  it('400 API_KEY_INVALID maps to the invalid-key sentence with no key material', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      errorResponse(400, { error: { message: 'API_KEY_INVALID', status: 'INVALID_ARGUMENT' } })
    );
    const res = await verifyGemini(
      postReq('http://localhost:3000/api/settings/verify-gemini', { 'x-gemini-api-key': GEMINI_KEY })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('This Gemini key is invalid. Generate a new one in Google AI Studio.');
    assertNoKeyMaterial(JSON.stringify(data), GEMINI_KEY);
  });

  it('403 maps to the not-permitted sentence', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      errorResponse(403, { error: { message: 'Forbidden' } })
    );
    const res = await verifyGemini(
      postReq('http://localhost:3000/api/settings/verify-gemini', { 'x-gemini-api-key': GEMINI_KEY })
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("This Gemini key isn't permitted to call the Generative Language API.");
  });
});

describe('verify-jules', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('happy path returns sources', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(true, { sources: [{ name: 'sources/abc', id: 'abc' }] })
    );
    const res = await verifyJules(
      postReq('http://localhost:3000/api/settings/verify-jules', { 'x-jules-api-key': JULES_KEY })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.sources).toEqual([{ name: 'sources/abc', id: 'abc' }]);
    expect(data.targetRepoConnected).toBeUndefined();
  });

  it('targetRepoConnected true when repo matches a source', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(true, {
        sources: [{ name: 'sources/github/acme/api', id: 'github-acme-api' }],
      })
    );
    const res = await verifyJules(
      postReq(
        'http://localhost:3000/api/settings/verify-jules',
        { 'x-jules-api-key': JULES_KEY, 'Content-Type': 'application/json' },
        { repo: 'acme/api' }
      )
    );
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.targetRepoConnected).toBe(true);
  });

  it('targetRepoConnected false with the not-connected sentence', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(true, { sources: [{ name: 'sources/other', id: 'other' }] })
    );
    const res = await verifyJules(
      postReq(
        'http://localhost:3000/api/settings/verify-jules',
        { 'x-jules-api-key': JULES_KEY, 'Content-Type': 'application/json' },
        { repo: 'acme/api' }
      )
    );
    const data = await res.json();
    expect(data.targetRepoConnected).toBe(false);
    expect(data.notConnectedNotice).toBe(
      "Jules works, but acme/api isn't connected. Visit jules.google.com to add it."
    );
  });

  it('401 maps to the unauthorized sentence with no key material', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      errorResponse(401, { error: { message: 'UNAUTHENTICATED' } })
    );
    const res = await verifyJules(
      postReq('http://localhost:3000/api/settings/verify-jules', { 'x-jules-api-key': JULES_KEY })
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("This Jules key isn't authorized. Generate one in Jules settings.");
    assertNoKeyMaterial(JSON.stringify(data), JULES_KEY);
  });

  it('unmapped 500 uses the status-only sentence', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      errorResponse(500, { error: { message: 'boom' } })
    );
    const res = await verifyJules(
      postReq('http://localhost:3000/api/settings/verify-jules', { 'x-jules-api-key': JULES_KEY })
    );
    const data = await res.json();
    expect(data.error).toBe('Provider responded with 500. Try again, or re-check the key.');
    expect(JSON.stringify(data)).not.toContain('boom');
  });

  it('timeout maps to the 5s sentence', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    const res = await verifyJules(
      postReq('http://localhost:3000/api/settings/verify-jules', { 'x-jules-api-key': JULES_KEY })
    );
    expect(res.status).toBe(504);
    const data = await res.json();
    expect(data.error).toBe("Provider didn't respond in 5s — try again.");
  }, 15000);
});

describe('redactSecrets', () => {
  it('masks token-like substrings and passes plain text through', () => {
    expect(redactSecrets('hello world')).toBe('hello world');
    expect(redactSecrets('key ghp_abcdef1234567890 done')).toBe('key [REDACTED] done');
    expect(redactSecrets('key AIzaSyD1234567890abcdefg done')).toBe('key [REDACTED] done');
    expect(redactSecrets('')).toBe('');
    expect(redactSecrets(null)).toBe('');
  });
});
