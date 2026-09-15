import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import {
  createJulesSession,
  resolveAutomationMode,
  resolveJulesSourceName,
  sanitizeJulesCredential,
} from '@/lib/jules';
import { compileJulesPrompt } from '@/lib/prompt-compiler';
import { AcceptanceCriterion, Blueprint } from '@/types';
import { preDispatchGate } from '@/lib/contract-lint';
import { parseRequestBody, JulesDispatchBodySchema } from '@/lib/validation';
import { verifyAuditedHead } from '@/lib/audited-head';

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  try {
    const bodyValidation = await parseRequestBody(JulesDispatchBodySchema, req, '/api/jules/dispatch', requestId);
    if (!bodyValidation.success) return bodyValidation.response;

    const {
      repo,
      objective: rawObjective,
      baseBranch = 'main',
      branchName,
      startingBranch,
      explicitStartingBranch: explicitStartingBranchArg,
      fileBoundaries,
      criteria: rawCriteria,
      isRemediation = false,
      dryRun = false,
      customPrompt,
      repoContext,
      testCommand = '',
      prNumber,
      auditedHeadSha,
    } = bodyValidation.data;

    const explicitStartingBranch = startingBranch || explicitStartingBranchArg;

    const cleanRepo = repo
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');

    const requestedHead = branchName?.trim() || explicitStartingBranch?.trim() || '';

    const targetBranch =
      requestedHead ||
      `jules/${(rawObjective || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}-${Math.floor(
        1000 + Math.random() * 9000
      )}`;

    const objective =
      rawObjective?.trim() ||
      (isRemediation
        ? `Remediate audit findings for Pull Request ${prNumber ? `#${prNumber}` : ''} on branch "${targetBranch}". Address all flagged blockers and unmet criteria.`
        : '');

    const criteria: AcceptanceCriterion[] =
      rawCriteria && rawCriteria.length > 0
        ? (rawCriteria as AcceptanceCriterion[])
        : isRemediation
        ? [
            {
              id: 'crit-rem-1',
              text: 'Resolve all key blockers identified in the Gemini audit report.',
              category: 'functional',
            },
            {
              id: 'crit-rem-2',
              text: 'Implement all unmet and partially met acceptance criteria.',
              category: 'functional',
            },
            {
              id: 'crit-rem-3',
              text: 'Apply all changes directly to the audited branch without introducing scope drift.',
              category: 'constraint',
            },
          ]
        : [];

    const headerJulesKey = req.headers.get('x-jules-api-key');
    const headerGithubPat = req.headers.get('x-github-pat');
    const julesApiKey =
      sanitizeJulesCredential(headerJulesKey || '') ||
      sanitizeJulesCredential(process.env.JULES_API_KEY || '');
    const githubPat = headerGithubPat?.trim() || process.env.GITHUB_PAT?.trim();

    if (isRemediation) {
      const headCheck = await verifyAuditedHead({
        repo: cleanRepo,
        prUrl: bodyValidation.data.prUrl,
        prNumber,
        auditedHeadSha: auditedHeadSha || '',
        githubPat,
      });
      if (!headCheck.ok) {
        return apiError('/api/jules/dispatch', requestId, {
          status: headCheck.status,
          code: 'INVALID_INPUT',
          message: headCheck.error,
        });
      }
    }

    if (!dryRun && !julesApiKey) {
      return apiError('/api/jules/dispatch', requestId, { status: 401, code: 'UNAUTHORIZED', message: 'No Google Jules API key configured. Provide an API key via request headers or environment variables, or enable dryRun mode.', details: { dryRun: false } });
    }

    const parsedBoundaries: string[] = Array.isArray(fileBoundaries)
      ? fileBoundaries
      : typeof fileBoundaries === 'string'
      ? fileBoundaries.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    let dispatchWarnings: string[] = [];
    if (!isRemediation && !(customPrompt && customPrompt.trim().length > 0)) {
      const treePaths =
        (repoContext as { treePaths?: string[] } | null)?.treePaths ||
        ((repoContext as { treePreview?: string[] } | null)?.treePreview as string[] | undefined) ||
        [];
      const gate = preDispatchGate({
        repo: cleanRepo,
        objective: objective.trim(),
        criteria,
        boundaries: parsedBoundaries,
        treePaths,
      });
      if (!gate.ok) {
        return apiError('/api/jules/dispatch', requestId, { status: 400, code: 'INVALID_INPUT', message: gate.errors.join(' '), details: { warnings: gate.warnings } });
      }
      dispatchWarnings = gate.warnings;
    }

    const blueprintId = `bp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const compiledPrompt =
      customPrompt && customPrompt.trim().length > 0
        ? customPrompt.trim()
        : compileJulesPrompt(
            {
              repo: cleanRepo,
              baseBranch: baseBranch.trim(),
              branchName: targetBranch,
              fileBoundaries: parsedBoundaries,
              objective: objective.trim(),
              criteria,
              repoContext: isRemediation ? null : (repoContext as any),
              testCommand: isRemediation ? '' : testCommand,
            },
            blueprintId
          );

    const effectiveStartingBranch =
      explicitStartingBranch?.trim() ||
      (isRemediation ? targetBranch : undefined) ||
      baseBranch.trim() ||
      'main';

    if (githubPat) {
      try {
        const ghCheck = await fetch(`https://api.github.com/repos/${cleanRepo}`, {
          headers: {
            Authorization: `Bearer ${githubPat}`,
            'User-Agent': 'RepoPilot-AuditEngine',
          },
        });
        if (!ghCheck.ok && ghCheck.status !== 404) {
        }
      } catch (err) {
      }
    }

    let sessionId: string | undefined = undefined;
    let sessionUrl: string | undefined = undefined;
    let sessionState: string | undefined = undefined;
    let sourceName: string | undefined = undefined;
    let julesApiResponse: unknown = null;

    if (!dryRun && julesApiKey) {
      const resolvedSource = await resolveJulesSourceName(julesApiKey, cleanRepo);
      if (!resolvedSource.ok) {
        return apiError('/api/jules/dispatch', requestId, { status: resolvedSource.status || 404, code: 'UPSTREAM_ERROR', message: resolvedSource.error || 'Source not connected in Jules', details: { dryRun: false, repo: cleanRepo, targetBranch } });
      }

      sourceName = resolvedSource.sourceName;
      const sessionTitle = `[RepoPilot] ${objective.slice(0, 80)}`;
      const automationMode = resolveAutomationMode(isRemediation);
      const julesResult = await createJulesSession({
        apiKey: julesApiKey,
        sourceName: sourceName as string,
        repo: cleanRepo,
        startingBranch: effectiveStartingBranch,
        prompt: compiledPrompt,
        title: sessionTitle,
        requirePlanApproval: false,
        ...(automationMode ? { automationMode } : {}),
      });

      if (!julesResult.ok) {
        return apiError('/api/jules/dispatch', requestId, { status: julesResult.status || 502, code: 'UPSTREAM_ERROR', message: julesResult.error || `Google Jules API error (HTTP ${julesResult.status})`, details: { dryRun: false, repo: cleanRepo, targetBranch, status: julesResult.status } });
      }

      if (!julesResult.sessionId) {
        return apiError('/api/jules/dispatch', requestId, { status: 502, code: 'UPSTREAM_ERROR', message: 'Jules returned no session id' });
      }
      sessionId = julesResult.sessionId;
      sessionUrl = julesResult.sessionUrl;
      sessionState = julesResult.state;
      julesApiResponse = julesResult.data;
    }

    if (dryRun) {
      sessionId = `dry_${blueprintId}`;
    }

    const completeBlueprint: Blueprint = {
      blueprintId,
      repo: cleanRepo,
      baseBranch: baseBranch.trim(),
      branchName: targetBranch,
      fileBoundaries: parsedBoundaries,
      objective: objective.trim(),
      criteria,
      createdAt: new Date().toISOString(),
      sessionId,
      compiledPrompt,
      sourceName,
      sessionUrl,
      sessionState,
      prUrl: undefined,
      prTitle: undefined,
      isRemediation,
      auditedHeadSha: isRemediation ? auditedHeadSha?.trim() || null : undefined,
    };

    return NextResponse.json({
      success: true,
      dryRun: Boolean(dryRun),
      blueprint: completeBlueprint,
      sessionId,
      sessionUrl,
      sessionState,
      targetBranch,
      repo: cleanRepo,
      baseBranch: baseBranch.trim(),
      apiStatus: dryRun ? 'LOCAL_DRY_RUN' : 'DISPATCHED_TO_JULES',
      julesApiResponse,
      githubUrl: `https://github.com/${cleanRepo}`,
      dispatchedAt: new Date().toISOString(),
      warnings: dispatchWarnings.length > 0 ? dispatchWarnings : undefined,
    });
  } catch (error) {
    return apiError('/api/jules/dispatch', requestId, { status: 500, code: 'INTERNAL_ERROR', message: 'Unknown dispatch error occurred.' });
  }
}
