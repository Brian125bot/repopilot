import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { generateAcceptanceCriteria } from '@/lib/gemini';
import { fallbackBoundariesFromTree, validateAndFilterBoundaries } from '@/lib/prompt-compiler';
import { RepoInspectionResult } from '@/types';
import { parseRequestBody, CriteriaGenerateBodySchema } from '@/lib/validation';

/** Cap for tree paths pulled for boundary grounding (sample up to 500). */
const GENERATE_TREE_PATH_CAP = 500;
/** How many top directories/files the model sees for grounding. */
const GENERATE_TREE_TOP_N = 40;

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  try {
    const bodyValidation = await parseRequestBody(CriteriaGenerateBodySchema, req, '/api/criteria/generate', requestId);
    if (!bodyValidation.success) return bodyValidation.response;

    const { repo, objective, repoContext, mode = 'standard' } = bodyValidation.data;

    const customApiKey = req.headers.get('x-gemini-api-key') || undefined;

    // Tree-ground the generation: fetch the real git tree so boundary
    // suggestions can be validated instead of trusted. Best-effort.
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
        const branch = (repoContext as Partial<RepoInspectionResult> | undefined)?.defaultBranch?.trim() || 'main';
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

    const castContext = repoContext as Partial<RepoInspectionResult> | undefined;
    const groundedContext: Partial<RepoInspectionResult> | undefined =
      groundPaths.length > 0
        ? {
            ...castContext,
            treePaths: [...groundPaths.slice(0, GENERATE_TREE_TOP_N), ...(castContext?.treePaths || [])].slice(
              0,
              GENERATE_TREE_PATH_CAP
            ),
          }
        : castContext;

    const result = await generateAcceptanceCriteria({
      repo: repo.trim(),
      objective: objective.trim(),
      repoContext: groundedContext,
      mode,
      customApiKey,
    });

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
    return apiError('/api/criteria/generate', requestId, { status: 500, code: 'INTERNAL_ERROR', message: 'Failed to generate acceptance criteria via Gemini.' });
  }
}
