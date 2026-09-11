import { NextRequest, NextResponse } from 'next/server';
import { sanitizeUnifiedDiff } from '@/lib/diff-sanitizer';
import { extractBlueprintFromPRBody } from '@/lib/prompt-compiler';
import { PRMetadata } from '@/types';

function parseGitHubPRUrl(input: string): { owner: string; repo: string; pullNumber: number } | null {
  const trimmed = input.trim();
  // Matches https://github.com/owner/repo/pull/123 or owner/repo/pull/123
  const urlMatch = trimmed.match(/(?:https?:\/\/github\.com\/)?([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      pullNumber: parseInt(urlMatch[3], 10),
    };
  }

  // Matches owner/repo #123
  const hashMatch = trimmed.match(/^([^/]+)\/([^#\s]+)(?:#|\s+)(\d+)$/);
  if (hashMatch) {
    return {
      owner: hashMatch[1],
      repo: hashMatch[2],
      pullNumber: parseInt(hashMatch[3], 10),
    };
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prUrl, owner, repo, pullNumber, rawDiff, fileBoundaries = [] } = body;

    const headerGithubPat = req.headers.get('x-github-pat');
    const githubPat = headerGithubPat || process.env.GITHUB_PAT;

    // Case 1: Direct raw diff supplied (e.g., local testing or pasted diff)
    if (rawDiff && typeof rawDiff === 'string' && rawDiff.trim().length > 0) {
      const sanitized = sanitizeUnifiedDiff(rawDiff, fileBoundaries);
      return NextResponse.json({
        success: true,
        isCustomDiff: true,
        sanitizedResult: sanitized,
        pr: {
          title: 'Manual Diff / Local Ingestion',
          number: 0,
          author: 'manual-input',
          htmlUrl: '#',
          baseBranch: 'main',
          headBranch: 'feature-branch',
          state: 'open',
          body: '',
          embeddedBlueprint: null,
        } as PRMetadata,
      });
    }

    // Case 2: Ingest from GitHub PR
    let prOwner = owner;
    let prRepo = repo;
    let prNum = pullNumber;

    if (prUrl) {
      const parsed = parseGitHubPRUrl(prUrl);
      if (!parsed) {
        return NextResponse.json(
          {
            error:
              'Invalid GitHub PR URL format. Expected: https://github.com/owner/repo/pull/123 or owner/repo#123',
          },
          { status: 400 }
        );
      }
      prOwner = parsed.owner;
      prRepo = parsed.repo;
      prNum = parsed.pullNumber;
    }

    if (!prOwner || !prRepo || !prNum) {
      return NextResponse.json(
        { error: 'Missing GitHub repository owner, repo, or pull request number.' },
        { status: 400 }
      );
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
    const prRes = await fetch(prDetailsUrl, { headers: githubHeaders });

    if (!prRes.ok) {
      const errBody = await prRes.text();
      const isRateLimited = prRes.status === 403 && errBody.includes('API rate limit exceeded');
      return NextResponse.json(
        {
          error: isRateLimited
            ? 'GitHub API rate limit reached. Please provide a GitHub Personal Access Token in API Settings.'
            : `Failed to fetch PR from GitHub (${prRes.status}): ${prRes.statusText}`,
          details: errBody,
        },
        { status: prRes.status }
      );
    }

    const prData = await prRes.json();
    const embeddedBlueprint = extractBlueprintFromPRBody(prData.body || '');

    // Merge boundaries: prioritize blueprint boundaries if present
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
    const diffRes = await fetch(prDetailsUrl, { headers: diffHeaders });

    if (diffRes.ok) {
      diffText = await diffRes.text();
    } else {
      // Fallback to public diff URL if API route failed
      try {
        const publicDiffUrl = `https://github.com/${prOwner}/${prRepo}/pull/${prNum}.diff`;
        const publicRes = await fetch(publicDiffUrl, {
          headers: { 'User-Agent': 'RepoPilot-AuditEngine' },
        });
        if (publicRes.ok) {
          diffText = await publicRes.text();
        }
      } catch (e) {
        console.warn('Fallback public diff fetch failed:', e);
      }
    }

    if (!diffText) {
      return NextResponse.json(
        { error: 'Could not retrieve git diff for this pull request.' },
        { status: 404 }
      );
    }

    // 3. Sanitize diff and compute blast radius stats
    const sanitizedResult = sanitizeUnifiedDiff(diffText, effectiveBoundaries);

    const prMetadata: PRMetadata = {
      title: prData.title || `PR #${prNum}`,
      number: prNum,
      author: prData.user?.login || 'unknown',
      authorAvatar: prData.user?.avatar_url,
      htmlUrl: prData.html_url || `https://github.com/${prOwner}/${prRepo}/pull/${prNum}`,
      baseBranch: prData.base?.ref || 'main',
      headBranch: prData.head?.ref || 'feature',
      state: prData.state || 'open',
      body: prData.body || '',
      embeddedBlueprint,
    };

    return NextResponse.json({
      success: true,
      pr: prMetadata,
      sanitizedResult,
    });
  } catch (error) {
    console.error('Error in /api/audit/fetch-diff:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch diff' },
      { status: 500 }
    );
  }
}
