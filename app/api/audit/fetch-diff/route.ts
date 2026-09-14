import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { sanitizeUnifiedDiff } from '@/lib/diff-sanitizer';
import { extractBlueprintFromPRBody } from '@/lib/prompt-compiler';
import { PRMetadata, GitHubStatusSummary } from '@/types';
import {
  fetchPullRequestChecks,
  fetchPullRequestMergeability,
  findPullRequestByHeadBranch,
  parseAuditIngestTarget,
  parseGitHubPRUrl,
  parseOwnerRepo,
} from '@/lib/github';
import { parseRequestBody, AuditFetchDiffBodySchema } from '@/lib/validation';

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  try {
    const bodyValidation = await parseRequestBody(AuditFetchDiffBodySchema, req, '/api/audit/fetch-diff', requestId);
    if (!bodyValidation.success) return bodyValidation.response;

    const {
      prUrl,
      owner,
      repo,
      pullNumber,
      headBranch,
      branchName,
      rawDiff,
      fileBoundaries = [],
    } = bodyValidation.data;

    const headerGithubPat = req.headers.get('x-github-pat');
    const githubPat = headerGithubPat?.trim() || process.env.GITHUB_PAT?.trim();

    // Case 1: Direct raw diff supplied (e.g., local testing or pasted diff).
    if (rawDiff && typeof rawDiff === 'string' && rawDiff.trim().length > 0) {
      const sanitized = sanitizeUnifiedDiff(rawDiff, fileBoundaries);
      return NextResponse.json({
        success: true,
        isCustomDiff: true,
        sanitizedResult: sanitized,
        githubStatus: null as GitHubStatusSummary | null,
        headSha: null,
        pr: {
          title: 'Manual Diff / Local Ingestion',
          number: 0,
          author: 'manual-input',
          htmlUrl: '#',
          baseBranch: 'main',
          headBranch: 'feature-branch',
          headSha: null,
          state: 'open',
          body: '',
          embeddedBlueprint: null,
        } as PRMetadata,
      });
    }

    // Case 2: Ingest from GitHub PR URL, owner/repo#n, or repo + head branch.
    let prOwner = typeof owner === 'string' ? owner.trim() : '';
    let prRepo = typeof repo === 'string' ? repo.trim() : '';
    let prNum = typeof pullNumber === 'number' ? pullNumber : Number(pullNumber) || 0;
    let branch = String(headBranch || branchName || '').trim();

    if (typeof repo === 'string' && repo.includes('/') && !prOwner) {
      const parsedRepo = parseOwnerRepo(repo);
      if (parsedRepo) {
        prOwner = parsedRepo.owner;
        prRepo = parsedRepo.repo;
      }
    }

    if (prUrl) {
      const parsed = parseAuditIngestTarget(String(prUrl));
      if (parsed.kind === 'pr') {
        prOwner = parsed.owner;
        prRepo = parsed.repo;
        prNum = parsed.pullNumber;
      } else if (parsed.kind === 'branch') {
        prOwner = parsed.owner;
        prRepo = parsed.repo;
        branch = parsed.headBranch;
      } else {
        const legacy = parseGitHubPRUrl(String(prUrl));
        if (!legacy) {
          return apiError('/api/audit/fetch-diff', requestId, { status: 400, code: 'INVALID_INPUT', message: 'Invalid GitHub PR URL format. Expected: https://github.com/owner/repo/pull/123, owner/repo#123, or owner/repo plus a head branch.' });
        }
        prOwner = legacy.owner;
        prRepo = legacy.repo;
        prNum = legacy.pullNumber;
      }
    }

    if (!prNum && prOwner && prRepo && branch) {
      const found = await findPullRequestByHeadBranch(prOwner, prRepo, branch, githubPat);
      if (!found.ok) {
        return apiError('/api/audit/fetch-diff', requestId, { status: found.status || 404, code: 'NOT_FOUND', message: found.error, details: { prPending: found.prPending === true, repo: `${prOwner}/${prRepo}`, headBranch: branch } });
      }
      prNum = found.pull.number;
    }

    if (!prOwner || !prRepo || !prNum) {
      return apiError('/api/audit/fetch-diff', requestId, { status: 400, code: 'INVALID_INPUT', message: 'Missing GitHub repository owner, repo, or pull request number. Provide a PR URL or a repo plus head branch.' });
    }

    const githubHeaders: Record<string, string> = {
      'User-Agent': 'RepoPilot-AuditEngine',
      Accept: 'application/vnd.github.v3+json',
    };
    if (githubPat) {
      githubHeaders['Authorization'] = `Bearer ${githubPat}`;
    }

    // 1. Fetch PR details
    const prDetailsUrl = `https://api.github.com/repos/${prOwner}/${prRepo}/pulls/${prNum}`;
    const prRes = await fetch(prDetailsUrl, { headers: githubHeaders, cache: 'no-store' });

    if (!prRes.ok) {
      const errBody = await prRes.text();
      const isRateLimited = prRes.status === 403 && errBody.includes('API rate limit exceeded');
      return apiError('/api/audit/fetch-diff', requestId, { status: prRes.status, code: 'UPSTREAM_ERROR', message: isRateLimited ? 'GitHub API rate limit reached. Please provide a GitHub Personal Access Token in API Settings.' : `Failed to fetch PR from GitHub (${prRes.status}): ${prRes.statusText}` });
    }

    const prData = await prRes.json();
    const embeddedBlueprint = extractBlueprintFromPRBody(prData.body || '');

    const effectiveBoundaries =
      embeddedBlueprint?.fileBoundaries && embeddedBlueprint.fileBoundaries.length > 0
        ? embeddedBlueprint.fileBoundaries
        : fileBoundaries;

    // 2. Fetch unified diff
    const diffHeaders: Record<string, string> = {
      'User-Agent': 'RepoPilot-AuditEngine',
      Accept: 'application/vnd.github.v3.diff',
    };
    if (githubPat) {
      diffHeaders['Authorization'] = `Bearer ${githubPat}`;
    }

    let diffText = '';
    const diffRes = await fetch(prDetailsUrl, { headers: diffHeaders, cache: 'no-store' });

    if (diffRes.ok) {
      diffText = await diffRes.text();
    } else {
      try {
        const publicDiffUrl = `https://github.com/${prOwner}/${prRepo}/pull/${prNum}.diff`;
        const publicRes = await fetch(publicDiffUrl, {
          headers: { 'User-Agent': 'RepoPilot-AuditEngine' },
        });
        if (publicRes.ok) {
          diffText = await publicRes.text();
        }
      } catch (e) {
      }
    }

    if (!diffText) {
      return apiError('/api/audit/fetch-diff', requestId, { status: 404, code: 'NOT_FOUND', message: 'Could not retrieve git diff for this pull request.' });
    }

    // 3. Sanitize diff and compute blast radius stats
    const sanitizedResult = sanitizeUnifiedDiff(diffText, effectiveBoundaries);

    // 4. Physical merge readiness
    const headSha = typeof prData.head?.sha === 'string' ? prData.head.sha : '';
    const [checks, mergeability] = await Promise.all([
      fetchPullRequestChecks(prOwner, prRepo, headSha, githubPat),
      fetchPullRequestMergeability(prOwner, prRepo, prNum, githubPat),
    ]);
    const failedRuns = checks.checkRuns.filter((r) =>
      ['failure', 'timed_out', 'action_required', 'cancelled', 'stale'].includes(
        (r.conclusion || '').toLowerCase()
      )
    );
    const githubStatus: GitHubStatusSummary = {
      mergeable: mergeability.mergeable,
      mergeableState: mergeability.mergeableState,
      checksState: checks.state,
      failedChecks: failedRuns.map((r) => r.name),
      checkRunUrls: failedRuns
        .filter((r) => r.detailsUrl)
        .map((r) => ({ name: r.name, detailsUrl: r.detailsUrl })),
    };

    const normalizedHeadSha = typeof prData.head?.sha === 'string' && prData.head.sha.trim() ? prData.head.sha.trim() : null;
    const prMetadata: PRMetadata = {
      title: prData.title || `PR #${prNum}`,
      number: prNum,
      author: prData.user?.login || 'unknown',
      authorAvatar: prData.user?.avatar_url,
      htmlUrl: prData.html_url || `https://github.com/${prOwner}/${prRepo}/pull/${prNum}`,
      baseBranch: prData.base?.ref || 'main',
      headBranch: prData.head?.ref || 'feature',
      headSha: normalizedHeadSha,
      state: prData.state || 'open',
      body: prData.body || '',
      embeddedBlueprint,
      githubStatus,
    };

    return NextResponse.json({
      success: true,
      pr: prMetadata,
      sanitizedResult,
      githubStatus,
      headSha: normalizedHeadSha,
    });
  } catch (error) {
    return apiError('/api/audit/fetch-diff', requestId, { status: 500, code: 'INTERNAL_ERROR', message: 'Failed to fetch diff' });
  }
}
