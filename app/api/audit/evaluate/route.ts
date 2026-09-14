import { NextRequest, NextResponse } from 'next/server';
import { evaluateDiffAgainstCriteria, MAX_EVALUATE_DIFF_CHARS } from '@/lib/gemini';
import { sanitizeUnifiedDiff } from '@/lib/diff-sanitizer';
import { AcceptanceCriterion, AuditDiffFacts } from '@/types';
import { unionUnauthorizedPaths } from '@/lib/scoring';
import { evaluateFailurePayload } from '@/lib/evaluate-timeout';
import { logRouteError, logger, getRequestId } from '@/lib/safe-log';
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
  const requestId = getRequestId(req);
  const start = performance.now();
  logger.info('Request entry', { route: '/api/audit/evaluate', method: 'GET', requestId });
  const queryValidation = parseQueryParams(AuditEvaluateQuerySchema, req);
  if (!queryValidation.success) return queryValidation.response;

  logger.info('Request complete', { route: '/api/audit/evaluate', method: 'GET', requestId, status: 200, latency: performance.now() - start });
  return NextResponse.json({ hasServerKey: Boolean(process.env.GEMINI_API_KEY?.trim()) });
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  const start = performance.now();
  logger.info('Request entry', { route: '/api/audit/evaluate', method: 'POST', requestId });
  try {
    const bodyValidation = await parseRequestBody(AuditEvaluateBodySchema, req);
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

    if (prMetadata) {
      report.prTitle = prMetadata.title;
      report.prAuthor = prMetadata.author;
      report.prNumber = prMetadata.number;
      report.prUrl = prMetadata.htmlUrl;
      report.baseBranch = prMetadata.baseBranch;
      report.headBranch = prMetadata.headBranch;
    }

    logger.info('Request complete', { route: '/api/audit/evaluate', method: 'POST', requestId, status: 200, latency: performance.now() - start });
    return NextResponse.json({
      success: true,
      report,
    });
  } catch (error) {
    logRouteError('/api/audit/evaluate', error);
    const failure = evaluateFailurePayload(error);
    logger.info('Request complete', { route: '/api/audit/evaluate', method: 'POST', requestId, status: failure.status, latency: performance.now() - start });
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
