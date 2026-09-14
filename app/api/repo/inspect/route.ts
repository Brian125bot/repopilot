import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { RepoInspectionResult } from '@/types';
import { parseRequestBody, RepoInspectBodySchema } from '@/lib/validation';

const TREE_CAP = 150;
const TREE_PREVIEW_CAP = 25;

function detectPackageManager(rootNames: string[], treePaths: string[]): string {
  const names = new Set([...rootNames.map((n) => n.toLowerCase()), ...treePaths.map((p) => p.toLowerCase())]);
  const has = (suffix: string) => [...names].some((n) => n === suffix || n.endsWith(`/${suffix}`));
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'npm';
}

function detectFramework(deps: string[]): string {
  const lower = deps.map((d) => d.toLowerCase());
  const find = (sub: string) => lower.find((d) => d.includes(sub));
  if (find('next')) return 'Next.js';
  if (find('nest')) return 'NestJS';
  if (find('fastify')) return 'Fastify';
  if (find('express')) return 'Express';
  if (find('react')) return 'React';
  if (find('vue')) return 'Vue';
  if (find('svelte')) return 'Svelte';
  return 'unknown';
}

function detectTestCommand(scripts: Record<string, string>, pm: string, deps: string[]): string {
  if (scripts.test && scripts.test.trim()) {
    if (pm === 'pnpm') return 'pnpm test';
    if (pm === 'yarn') return 'yarn test';
    if (pm === 'bun') return 'bun test';
    return 'npm test';
  }
  const lowerDeps = deps.map((d) => d.toLowerCase()).join(' ');
  if (lowerDeps.includes('vitest')) return pm === 'npm' ? 'npx vitest run' : `${pm} vitest run`;
  if (lowerDeps.includes('jest')) return pm === 'npm' ? 'npx jest' : `${pm} jest`;
  if (lowerDeps.includes('playwright')) return pm === 'npm' ? 'npx playwright test' : `${pm} playwright test`;
  return '';
}

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  try {
    const bodyValidation = await parseRequestBody(RepoInspectBodySchema, req, '/api/repo/inspect', requestId);
    if (!bodyValidation.success) return bodyValidation.response;

    const { repo } = bodyValidation.data;

    const [owner, repoName] = repo.trim().split('/');

    const githubPat = req.headers.get('x-github-pat') || process.env.GITHUB_PAT;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'RepoPilot-Auditor',
    };

    if (githubPat) {
      headers.Authorization = `token ${githubPat}`;
    }

    // 1. Fetch Repository Metadata
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
      headers,
      next: { revalidate: 300 },
    });

    if (!repoRes.ok) {
      const errorData = await repoRes.json().catch(() => ({}));
      const isRateLimit = repoRes.status === 403 && repoRes.headers.get('x-ratelimit-remaining') === '0';

      const fallback: RepoInspectionResult = {
        repo: `${owner}/${repoName}`,
        name: repoName,
        owner,
        defaultBranch: 'main',
        isReachable: false,
        visibility: 'unknown',
        error: isRateLimit
          ? 'GitHub API rate limit exceeded for unauthenticated requests. Add a GitHub PAT in Settings to unlock 5,000 req/hr.'
          : errorData.message || `GitHub returned HTTP ${repoRes.status}`,
        treePreview: ['src/', 'tests/', 'README.md'],
        treePaths: ['src/', 'tests/', 'README.md'],
        treeTruncated: false,
        primaryLanguage: 'TypeScript',
      };

      return NextResponse.json(fallback);
    }

    const repoData = await repoRes.json();
    const defaultBranch: string = repoData.default_branch || 'main';

    // 2. Fetch root contents
    const contentsRes = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/contents`,
      { headers, next: { revalidate: 300 } }
    );

    let treePreview: string[] = [];
    let rootNames: string[] = [];
    const keyFiles = {
      hasPackageJson: false,
      hasTsConfig: false,
      hasDocker: false,
      hasTests: false,
      dependenciesSummary: [] as string[],
      scriptsSummary: {} as Record<string, string>,
      testCommand: '',
      framework: 'unknown',
      packageManager: 'npm',
    };

    if (contentsRes.ok) {
      const contentsData = await contentsRes.json();
      if (Array.isArray(contentsData)) {
        rootNames = contentsData.map((item: { name: string }) => item.name);
        treePreview = contentsData.map((item: { name: string; type: string }) =>
          item.type === 'dir' ? `${item.name}/` : item.name
        );

        keyFiles.hasPackageJson = contentsData.some((i) => i.name === 'package.json');
        keyFiles.hasTsConfig = contentsData.some((i) => i.name === 'tsconfig.json');
        keyFiles.hasDocker = contentsData.some((i) =>
          ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'].includes(i.name)
        );
        keyFiles.hasTests = contentsData.some((i) =>
          ['tests', 'test', '__tests__', 'spec'].includes(i.name)
        );

        if (keyFiles.hasPackageJson) {
          try {
            const pkgRes = await fetch(
              `https://api.github.com/repos/${owner}/${repoName}/contents/package.json`,
              { headers, next: { revalidate: 300 } }
            );
            if (pkgRes.ok) {
              const pkgData = await pkgRes.json();
              if (pkgData.content && pkgData.encoding === 'base64') {
                const decoded = Buffer.from(pkgData.content, 'base64').toString('utf-8');
                const parsed = JSON.parse(decoded);
                const allDeps = {
                  ...(parsed.dependencies || {}),
                  ...(parsed.devDependencies || {}),
                };
                const majorFrameworks = [
                  'next',
                  'react',
                  'vue',
                  'svelte',
                  'express',
                  'fastify',
                  'nest',
                  'tailwind',
                  'tailwindcss',
                  'prisma',
                  'drizzle-orm',
                  'redis',
                  'ioredis',
                  'vitest',
                  'jest',
                  'zod',
                ];
                const depNames = Object.keys(allDeps);
                keyFiles.dependenciesSummary = depNames
                  .filter((dep) =>
                    majorFrameworks.some((mf) => dep.toLowerCase().includes(mf))
                  )
                  .slice(0, 8);
                const scripts: Record<string, string> = parsed.scripts || {};
                const keepScripts: Record<string, string> = {};
                for (const k of ['test', 'lint', 'build', 'typecheck', 'type-check']) {
                  if (typeof scripts[k] === 'string' && scripts[k].trim()) {
                    keepScripts[k] = scripts[k].trim().slice(0, 120);
                  }
                }
                keyFiles.scriptsSummary = keepScripts;
                (keyFiles as { _depNames?: string[] })._depNames = depNames;
              }
            }
          } catch {
            // Ignore package.json parsing error
          }
        }
      }
    }

    // 3. Recursive tree
    let treePaths: string[] = [];
    let treeTruncated = false;
    try {
      const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
        { headers, next: { revalidate: 300 } }
      );
      if (treeRes.ok) {
        const treeData = await treeRes.json();
        const truncated = treeData.truncated === true;
        const entries: { path?: string; type?: string }[] = Array.isArray(treeData.tree)
          ? treeData.tree
          : [];
        const blobs = entries
          .filter((e) => e.type === 'blob' && typeof e.path === 'string')
          .map((e) => e.path as string)
          .filter((p) => !p.startsWith('.git/'));
        treeTruncated = truncated || blobs.length > TREE_CAP;
        treePaths = blobs.slice(0, TREE_CAP);
        if (!keyFiles.hasTests) {
          keyFiles.hasTests = blobs.some((p) =>
            /(^|\/)(tests?|__tests__|spec)(\/|$)/i.test(p) || /\.test\.|\.spec\./i.test(p)
          );
        }
      }
    } catch {
      // Ignore
    }
    if (treePaths.length === 0) {
      treePaths = treePreview.slice(0, TREE_CAP);
      treeTruncated = false;
    }

    // 4. Derive metadata
    const depNames =
      (keyFiles as unknown as { _depNames?: string[] })._depNames ||
      keyFiles.dependenciesSummary ||
      [];
    delete (keyFiles as unknown as { _depNames?: string[] })._depNames;
    keyFiles.packageManager = detectPackageManager(rootNames, treePaths);
    keyFiles.framework = detectFramework(depNames);
    const scriptsSummary = keyFiles.scriptsSummary || {};
    const scriptsRecord: Record<string, string> = scriptsSummary;
    keyFiles.testCommand = detectTestCommand(scriptsRecord, keyFiles.packageManager, depNames);

    const inspection: RepoInspectionResult = {
      repo: `${owner}/${repoName}`,
      name: repoData.name,
      owner: repoData.owner?.login || owner,
      description: repoData.description || undefined,
      defaultBranch,
      primaryLanguage: repoData.language || undefined,
      topics: repoData.topics || [],
      treePreview: treePreview.slice(0, TREE_PREVIEW_CAP),
      treePaths,
      treeTruncated,
      keyFiles,
      isReachable: true,
      visibility: repoData.private ? 'private' : 'public',
    };

    return NextResponse.json(inspection);
  } catch (error: unknown) {
    return apiError('/api/repo/inspect', requestId, { status: 500, code: 'INTERNAL_ERROR', message: 'Failed to inspect repository state.' });
  }
}
