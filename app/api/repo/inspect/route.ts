import { NextRequest, NextResponse } from 'next/server';
import { RepoInspectionResult } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const { repo } = (await req.json()) as { repo: string };

    if (!repo || !repo.includes('/')) {
      return NextResponse.json(
        { error: 'Repository must be in "owner/repo" format (e.g., vercel/next.js).' },
        { status: 400 }
      );
    }

    const [owner, repoName] = repo.trim().split('/');
    if (!owner || !repoName) {
      return NextResponse.json(
        { error: 'Invalid owner/repo format.' },
        { status: 400 }
      );
    }

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
        primaryLanguage: 'TypeScript',
      };

      return NextResponse.json(fallback);
    }

    const repoData = await repoRes.json();

    // 2. Fetch root contents to discover structure
    const contentsRes = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/contents`,
      { headers, next: { revalidate: 300 } }
    );

    let treePreview: string[] = [];
    const keyFiles = {
      hasPackageJson: false,
      hasTsConfig: false,
      hasDocker: false,
      hasTests: false,
      dependenciesSummary: [] as string[],
    };

    if (contentsRes.ok) {
      const contentsData = await contentsRes.json();
      if (Array.isArray(contentsData)) {
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

        // If package.json exists, attempt to inspect package.json for key dependencies
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
                keyFiles.dependenciesSummary = Object.keys(allDeps)
                  .filter((dep) =>
                    majorFrameworks.some((mf) => dep.toLowerCase().includes(mf))
                  )
                  .slice(0, 8);
              }
            }
          } catch {
            // Ignore package.json parsing error
          }
        }
      }
    }

    const inspection: RepoInspectionResult = {
      repo: `${owner}/${repoName}`,
      name: repoData.name,
      owner: repoData.owner?.login || owner,
      description: repoData.description || undefined,
      defaultBranch: repoData.default_branch || 'main',
      primaryLanguage: repoData.language || undefined,
      topics: repoData.topics || [],
      treePreview: treePreview.slice(0, 25),
      keyFiles,
      isReachable: true,
      visibility: repoData.private ? 'private' : 'public',
    };

    return NextResponse.json(inspection);
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('Error inspecting repository:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to inspect repository state.' },
      { status: 500 }
    );
  }
}
