import { NextRequest, NextResponse } from 'next/server';
import { generateAcceptanceCriteria } from '@/lib/gemini';
import { fallbackBoundariesFromTree, validateAndFilterBoundaries } from '@/lib/prompt-compiler';
import { logRouteError } from '@/lib/safe-log';
import { RepoInspectionResult } from '@/types';

/** Cap for tree paths pulled for boundary grounding (sample up to 500). */
const GENERATE_TREE_PATH_CAP = 500;
/** How many top directories/files the model sees for grounding. */
const GENERATE_TREE_TOP_N = 40;

interface CriteriaRequestBody {
  repo: string;
  objective: string;
  repoContext?: Partial<RepoInspectionResult>;
  mode?: 'standard' | 'security' | 'testing' | 'strict';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CriteriaRequestBody;
    const { repo, objective, repoContext, mode = 'standard' } = body;

    if (!repo || !repo.includes('/')) {
      return NextResponse.json(
        { error: 'Valid repository in "owner/repo" format is required.' },
        { status: 400 }
      );
    }

    if (!objective || objective.trim().length < 10) {
      return NextResponse.json(
        { error: 'Please provide a descriptive task objective (at least 10 characters) to establish criteria.' },
        { status: 400 }
      );
    }

    const customApiKey = req.headers.get('x-gemini-api-key') || undefined;

    // Tree-ground the generation: fetch the real git tree so boundary
    // suggestions can be validated instead of trusted. Best-effort — on any
    // failure we proceed with the caller-supplied context unchanged.
    const [treeOwner, treeRepo] = repo.trim().split('/');
    let groundPaths: string[] = [];
    if (treeOwner && treeRepo) {
      try {
        const githubPat = req.headers.get('x-github-pat') || process.env.GITHUB_PAT;
        const ghHeaders: Record<string, string> = {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'RepoPilot-Auditor',
        };
        if (githubPat?.trim()) ghHeaders.Authorization = `token ${githubPat.trim()}`;
        const branch = repoContext?.defaultBranch?.trim() || 'main';
        const treeRes = await fetch(
          `https://api.github.com/repos/${treeOwner}/${treeRepo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
          { headers: ghHeaders, next: { revalidate: 300 } }
        );
        if (treeRes.ok) {
          const treeData = await treeRes.json();
          const entries: { path?: string; type?: string }[] = Array.isArray(treeData.tree)
            ? treeData.tree
            : [];
          groundPaths = entries
            .filter((e) => e.type === 'blob' && typeof e.path === 'string' && !e.path.startsWith('.git/'))
            .map((e) => e.path as string)
            .slice(0, GENERATE_TREE_PATH_CAP);
        }
      } catch {
        // Ignore — generation falls back to caller-supplied repoContext.
      }
    }

    const groundedContext: Partial<RepoInspectionResult> | undefined =
      groundPaths.length > 0
        ? {
            ...repoContext,
            // Top-40 first so the model grounds on real directories/files.
            treePaths: [...groundPaths.slice(0, GENERATE_TREE_TOP_N), ...(repoContext?.treePaths || [])].slice(
              0,
              GENERATE_TREE_PATH_CAP
            ),
          }
        : repoContext;

    const result = await generateAcceptanceCriteria({
      repo: repo.trim(),
      objective: objective.trim(),
      repoContext: groundedContext,
      mode,
      customApiKey,
    });

    // Validate the model's boundaries against the real tree; strip hallucinated
    // globs, falling back to real top-level dirs only when all are invalid.
    // Empty tree means "cannot validate" — keep the model output untouched.
    let rejectedGlobs: string[] = [];
    if (groundPaths.length > 0 && Array.isArray(result.recommendedFileBoundaries)) {
      const { validGlobs, rejectedGlobs: rejected } = validateAndFilterBoundaries(
        result.recommendedFileBoundaries,
        groundPaths
      );
      rejectedGlobs = rejected;
      result.recommendedFileBoundaries =
        validGlobs.length > 0 ? validGlobs : fallbackBoundariesFromTree(groundPaths);
    }

    return NextResponse.json({ ...result, rejectedGlobs });
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number };
    logRouteError('/api/criteria/generate', err);
    return NextResponse.json(
      {
        error: err.message || 'Failed to generate acceptance criteria via Gemini.',
      },
      { status: 500 }
    );
  }
}
