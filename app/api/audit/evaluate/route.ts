import { NextRequest, NextResponse } from 'next/server';
import { evaluateDiffAgainstCriteria } from '@/lib/gemini';
import { sanitizeUnifiedDiff } from '@/lib/diff-sanitizer';
import { AcceptanceCriterion } from '@/types';

/** Presence probe so the Settings modal can show server-key status without spending a Gemini call. */
export async function GET() {
  return NextResponse.json({ hasServerKey: Boolean(process.env.GEMINI_API_KEY?.trim()) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { diff, criteria, objective, fileBoundaries, unauthorizedPaths, prMetadata } = body;

    if (!diff || typeof diff !== 'string' || diff.trim().length === 0) {
      return NextResponse.json(
        { error: 'Cannot evaluate empty diff. Please provide a valid sanitized diff.' },
        { status: 400 }
      );
    }

    if (!criteria || !Array.isArray(criteria) || criteria.length === 0) {
      return NextResponse.json(
        { error: 'Acceptance criteria matrix is required for audit evaluation.' },
        { status: 400 }
      );
    }

    const headerGeminiKey = req.headers.get('x-gemini-api-key');
    const customApiKey = headerGeminiKey || undefined;

    // Union is add-only: re-derived hits first, then client-only extras.
    // The client list is the only witness for lockfile/secret hunks stripped
    // from the sanitized text, so an empty client list never clears re-derived hits.
    const clientPaths = Array.isArray(unauthorizedPaths) ? unauthorizedPaths : [];
    let derivedPaths: string[] = [];
    if (Array.isArray(fileBoundaries) && fileBoundaries.length > 0 && diff.includes('diff --git')) {
      try {
        derivedPaths = sanitizeUnifiedDiff(diff, fileBoundaries).stats.unauthorizedPaths ?? [];
      } catch {
        derivedPaths = [];
      }
    }
    const forcedPaths = Array.from(new Set([...derivedPaths, ...clientPaths].filter(Boolean)));

    const report = await evaluateDiffAgainstCriteria({
      diff,
      criteria: criteria as AcceptanceCriterion[],
      objective,
      fileBoundaries,
      unauthorizedPaths: forcedPaths,
      customApiKey,
    });

    // Attach PR context if available
    if (prMetadata) {
      report.prTitle = prMetadata.title;
      report.prAuthor = prMetadata.author;
      report.prNumber = prMetadata.number;
      report.prUrl = prMetadata.htmlUrl;
      report.baseBranch = prMetadata.baseBranch;
      report.headBranch = prMetadata.headBranch;
    }

    return NextResponse.json({
      success: true,
      report,
    });
  } catch (error) {
    console.error('Error in /api/audit/evaluate:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Evaluation failed. Please verify GEMINI_API_KEY.',
      },
      { status: 500 }
    );
  }
}
