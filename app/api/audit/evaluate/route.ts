import { NextRequest, NextResponse } from 'next/server';
import { evaluateDiffAgainstCriteria, MAX_EVALUATE_DIFF_CHARS } from '@/lib/gemini';
import { sanitizeUnifiedDiff } from '@/lib/diff-sanitizer';
import { AcceptanceCriterion, AuditDiffFacts } from '@/types';
import { unionUnauthorizedPaths } from '@/lib/scoring';
import { evaluateFailurePayload } from '@/lib/evaluate-timeout';
import { logRouteError } from '@/lib/safe-log';

/** Next.js requires a numeric literal here (must match EVALUATE_MAX_DURATION_SECONDS). */
export const maxDuration = 60;

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

    // Union is add-only: re-derived hits ∪ client extras ∪ (later) model flags.
    // The client list is the only witness for lockfile/secret hunks stripped
    // from the sanitized text, so an empty client list never clears re-derived hits.
    const clientPaths = Array.isArray(unauthorizedPaths) ? unauthorizedPaths : [];
    let derivedPaths: string[] = [];
    let touchedPaths: string[] = [];
    let sanitizerTruncated = false;
    let diffFacts: AuditDiffFacts | undefined;
    if (typeof diff === 'string' && diff.includes('diff --git')) {
      try {
        const sanitized = sanitizeUnifiedDiff(
          diff,
          Array.isArray(fileBoundaries) ? fileBoundaries : []
        );
        derivedPaths = sanitized.stats.unauthorizedPaths ?? [];
        touchedPaths = sanitized.stats.touchedPaths ?? [];
        sanitizerTruncated = sanitized.isTruncated;
        const forcedSoFar = unionUnauthorizedPaths(derivedPaths, clientPaths);
        diffFacts = {
          filesTouched: sanitized.stats.totalFilesTouched,
          linesAdded: sanitized.stats.linesAdded,
          linesRemoved: sanitized.stats.linesRemoved,
          unauthorizedCount: forcedSoFar.length,
          truncated: sanitizerTruncated || diff.length > MAX_EVALUATE_DIFF_CHARS,
          shownChars: Math.min(diff.length, MAX_EVALUATE_DIFF_CHARS),
          touchedPaths,
          unauthorizedPaths: forcedSoFar,
        };
      } catch {
        derivedPaths = [];
      }
    }
    const forcedPaths = unionUnauthorizedPaths(derivedPaths, clientPaths);
    if (diffFacts) {
      diffFacts = {
        ...diffFacts,
        unauthorizedCount: forcedPaths.length,
        unauthorizedPaths: forcedPaths,
        truncated: sanitizerTruncated || diff.length > MAX_EVALUATE_DIFF_CHARS,
        shownChars: Math.min(diff.length, MAX_EVALUATE_DIFF_CHARS),
        touchedPaths: touchedPaths.length > 0 ? touchedPaths : diffFacts.touchedPaths,
      };
    } else if (forcedPaths.length > 0) {
      // Non-git diff (e.g. already-sanitized text): still carry the client union
      // so severity grounding and Next-decision see the same violation count.
      diffFacts = {
        filesTouched: 0,
        linesAdded: 0,
        linesRemoved: 0,
        unauthorizedCount: forcedPaths.length,
        truncated: diff.length > MAX_EVALUATE_DIFF_CHARS,
        shownChars: Math.min(diff.length, MAX_EVALUATE_DIFF_CHARS),
        touchedPaths: [],
        unauthorizedPaths: forcedPaths,
      };
    }

    const report = await evaluateDiffAgainstCriteria({
      diff,
      criteria: criteria as AcceptanceCriterion[],
      objective,
      fileBoundaries,
      unauthorizedPaths: forcedPaths,
      customApiKey,
      diffFacts,
      touchedPaths,
    });

    if (diffFacts && !report.diffFacts) report.diffFacts = diffFacts;

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
    logRouteError('/api/audit/evaluate', error);
    const failure = evaluateFailurePayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
