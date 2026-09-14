import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { evaluateDiffAgainstCriteria, MAX_EVALUATE_DIFF_CHARS } from '@/lib/gemini';
import { sanitizeUnifiedDiff } from '@/lib/diff-sanitizer';
import { AcceptanceCriterion, AuditDiffFacts } from '@/types';
import { unionUnauthorizedPaths } from '@/lib/scoring';
import { evaluateFailurePayload } from '@/lib/evaluate-timeout';
import {
  parseRequestBody,
  parseQueryParams,
  AuditEvaluateBodySchema,
  AuditEvaluateQuerySchema,
} from '@/lib/validation';

/** Next.js requires a numeric literal here (must match EVALUATE_MAX_DURATION_SECONDS). */
export const maxDuration = 60;

/** Presence probe so the Settings modal can show server-key status without spending a Gemini call. */
export async function GET(req: NextRequest) {
  const requestId = createRequestId();
  const queryValidation = parseQueryParams(AuditEvaluateQuerySchema, req, '/api/audit/evaluate', requestId);
  if (!queryValidation.success) return queryValidation.response;

  return NextResponse.json({ hasServerKey: Boolean(process.env.GEMINI_API_KEY?.trim()) });
}

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  try {
    const bodyValidation = await parseRequestBody(AuditEvaluateBodySchema, req, '/api/audit/evaluate', requestId);
    if (!bodyValidation.success) return bodyValidation.response;

    const { diff, criteria, objective, fileBoundaries, unauthorizedPaths, prMetadata } = bodyValidation.data;

    const headerGeminiKey = req.headers.get('x-gemini-api-key');
    const customApiKey = headerGeminiKey || undefined;

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

    const auditedHeadSha =
      typeof prMetadata?.headSha === 'string' && prMetadata.headSha.trim()
        ? prMetadata.headSha.trim()
        : null;

    if (prMetadata) {
      report.prTitle = prMetadata.title;
      report.prAuthor = prMetadata.author;
      report.prNumber = prMetadata.number;
      report.prUrl = prMetadata.htmlUrl;
      report.baseBranch = prMetadata.baseBranch;
      report.headBranch = prMetadata.headBranch;
    }
    // COR-40: lock the graded commit. Null blocks remediation until re-evaluate.
    report.auditedHeadSha = auditedHeadSha;

    return NextResponse.json({
      success: true,
      report,
      auditedHeadSha,
    });
  } catch (error) {
    const failure = evaluateFailurePayload(error);
    return apiError('/api/audit/evaluate', requestId, { status: failure.status, code: 'REQUEST_FAILED', message: failure.body.error || 'Audit evaluation failed.', details: failure.body });
  }
}
