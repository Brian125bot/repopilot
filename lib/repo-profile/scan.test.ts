import { describe, it, expect, vi } from 'vitest';
import { scanRepository } from './scan';

describe('scanRepository orchestrator', () => {
  it('scans a repo and returns a full RepoProfile when endpoints succeed', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/repos/octocat/Hello-World')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ default_branch: 'main', language: 'TypeScript' }),
        });
      }
      if (url.endsWith('/repos/octocat/Hello-World/contents')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([
            { name: 'package.json', type: 'file' },
            { name: 'pnpm-lock.yaml', type: 'file' },
          ]),
        });
      }
      if (url.endsWith('/repos/octocat/Hello-World/contents/package.json')) {
        const pkg = {
          dependencies: { next: '^14.0.0', react: '^18.0.0' },
          devDependencies: { vitest: '^1.0.0', typescript: '^5.0.0' },
        };
        const encoded = Buffer.from(JSON.stringify(pkg)).toString('base64');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ content: encoded, encoding: 'base64' }),
        });
      }
      if (url.includes('/commits?per_page=30')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([
            { commit: { message: 'feat(core): initial setup' } },
            { commit: { message: 'fix(api): handle 404' } },
          ]),
        });
      }
      if (url.includes('/contents/')) {
        if (url.endsWith('.eslintrc.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ name: '.eslintrc.json' }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve('Not Found'),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') });
    });

    const result = await scanRepository({
      owner: 'octocat',
      repo: 'Hello-World',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.incomplete).toBe(false);
    expect(result.profile.id).toBe('octocat/Hello-World');
    expect(result.profile.repoRef.owner).toBe('octocat');
    expect(result.profile.repoRef.repo).toBe('Hello-World');
    expect(result.profile.repoRef.defaultBranch).toBe('main');
    expect(result.profile.stack.framework).toBe('Next.js');
    expect(result.profile.stack.testRunner).toBe('Vitest');
    expect(result.profile.stack.packageManager).toBe('pnpm');
    expect(result.profile.stack.languages).toContain('TypeScript');
    expect(result.profile.conventions.length).toBeGreaterThan(0);
  });

  it('fails soft when individual endpoints fail, producing a partial profile', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/repos/octocat/Hello-World')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ default_branch: 'main', language: 'JavaScript' }),
        });
      }
      // Fail root contents endpoint
      if (url.endsWith('/repos/octocat/Hello-World/contents')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
        });
      }
      // Commits endpoint
      if (url.includes('/commits')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') });
    });

    const result = await scanRepository({
      owner: 'octocat',
      repo: 'Hello-World',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.incomplete).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.profile.id).toBe('octocat/Hello-World');
    expect(result.profile.repoRef.owner).toBe('octocat');
  });

  it('retries once on 403 status with backoff before treating as failure or succeeding', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 403,
          text: () => Promise.resolve('Rate Limit Exceeded'),
        });
      }
      if (url.endsWith('/repos/octocat/Hello-World')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ default_branch: 'main', language: 'TypeScript' }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') });
    });

    const result = await scanRepository({
      owner: 'octocat',
      repo: 'Hello-World',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(callCount).toBeGreaterThan(1);
    expect(result.profile.id).toBe('octocat/Hello-World');
  });

  it('saves partial profile with incomplete: true when cancelled via AbortSignal', async () => {
    const controller = new AbortController();

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/repos/octocat/Hello-World')) {
        // Abort right during first call
        controller.abort();
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ default_branch: 'main' }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') });
    });

    const result = await scanRepository({
      owner: 'octocat',
      repo: 'Hello-World',
      signal: controller.signal,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.incomplete).toBe(true);
    expect(result.profile.id).toBe('octocat/Hello-World');
  });
});
