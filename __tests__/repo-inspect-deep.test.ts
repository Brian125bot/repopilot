import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/repo/inspect/route';
import { NextRequest } from 'next/server';

function req(repo: string) {
  return new NextRequest('http://localhost:3000/api/repo/inspect', {
    method: 'POST',
    body: JSON.stringify({ repo }),
  });
}

function jsonResponse(data: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => data, headers: new Headers() } as unknown as Response;
}

describe('repo inspect deep fetch (P1)', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('rejects non owner/repo format with 400', async () => {
    const res = await POST(req('badformat'));
    expect(res.status).toBe(400);
  });

  it('returns reachable inspection with recursive tree, test command, framework, pm', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/repos/acme/api')) {
        return jsonResponse({
          name: 'api', owner: { login: 'acme' }, description: 'svc',
          default_branch: 'main', language: 'TypeScript', topics: ['api'], private: false,
        });
      }
      if (url.endsWith('/repos/acme/api/contents')) {
        return jsonResponse([
          { name: 'src', type: 'dir' },
          { name: 'package.json', type: 'file' },
          { name: 'tsconfig.json', type: 'file' },
        ]);
      }
      if (url.endsWith('/repos/acme/api/contents/package.json')) {
        const pkg = {
          dependencies: { next: '15.0.0', react: '19.0.0' },
          devDependencies: { vitest: '1.0.0' },
          scripts: { test: 'vitest run', lint: 'eslint .', build: 'next build' },
        };
        return jsonResponse({
          content: Buffer.from(JSON.stringify(pkg)).toString('base64'),
          encoding: 'base64',
        });
      }
      if (url.includes('/git/trees/main?recursive=1')) {
        return jsonResponse({
          truncated: false,
          tree: [
            { path: 'src/middleware/rate-limiter.ts', type: 'blob' },
            { path: 'tests/rate-limiter.test.ts', type: 'blob' },
            { path: 'package.json', type: 'blob' },
            { path: '.git/internal', type: 'blob' },
          ],
        });
      }
      return jsonResponse({}, false, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(req('acme/api'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isReachable).toBe(true);
    expect(data.treePaths).toContain('src/middleware/rate-limiter.ts');
    expect(data.treePaths).not.toContain('.git/internal');
    expect(data.treeTruncated).toBe(false);
    expect(data.keyFiles.testCommand).toBe('npm test');
    expect(data.keyFiles.framework).toBe('Next.js');
    expect(data.keyFiles.packageManager).toBe('npm');
    expect(data.keyFiles.scriptsSummary.test).toContain('vitest');
    expect(data.keyFiles.hasTests).toBe(true);
  });

  it('detects pnpm + yarn managers from lockfiles and caps tree at 150', async () => {
    const bigTree = Array.from({ length: 200 }, (_, i) => ({ path: `src/file-${i}.ts`, type: 'blob' }));
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/repos/acme/big')) {
        return jsonResponse({ name: 'big', owner: { login: 'acme' }, default_branch: 'main', language: 'TypeScript', private: false });
      }
      if (url.endsWith('/repos/acme/big/contents')) {
        return jsonResponse([{ name: 'pnpm-lock.yaml', type: 'file' }, { name: 'src', type: 'dir' }]);
      }
      if (url.includes('/git/trees/main?recursive=1')) {
        return jsonResponse({ truncated: true, tree: bigTree });
      }
      return jsonResponse({}, false, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(req('acme/big'));
    const data = await res.json();
    expect(data.keyFiles.packageManager).toBe('pnpm');
    expect(data.treePaths).toHaveLength(150);
    expect(data.treeTruncated).toBe(true);
  });

  it('falls back to root preview when trees API fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/repos/acme/fallback')) {
        return jsonResponse({ name: 'fallback', owner: { login: 'acme' }, default_branch: 'develop', language: 'Go', private: false });
      }
      if (url.endsWith('/repos/acme/fallback/contents')) {
        return jsonResponse([{ name: 'pkg', type: 'dir' }, { name: 'go.mod', type: 'file' }]);
      }
      if (url.includes('/git/trees/')) {
        return jsonResponse({}, false, 403);
      }
      return jsonResponse({}, false, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(req('acme/fallback'));
    const data = await res.json();
    expect(data.defaultBranch).toBe('develop');
    expect(data.treePaths).toEqual(data.treePreview);
    expect(data.treeTruncated).toBe(false);
  });

  it('returns unreachable fallback on repo 404 and on rate limit with helpful message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'Not Found' }, false, 404)));
    const res404 = await POST(req('acme/missing'));
    const d404 = await res404.json();
    expect(d404.isReachable).toBe(false);
    expect(d404.treePreview).toContain('src/');

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 403,
      headers: new Headers({ 'x-ratelimit-remaining': '0' }),
      json: async () => ({}),
    }) as unknown as Response));
    const resRL = await POST(req('acme/rl'));
    const dRL = await resRL.json();
    expect(dRL.error).toMatch(/rate limit/i);
  });
});
