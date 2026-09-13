import { NextRequest, NextResponse } from 'next/server';
import { logRouteError } from '@/lib/safe-log';
import { compileJulesPrompt } from '@/lib/prompt-compiler';
import { preDispatchGate } from '@/lib/contract-lint';
import {
  createJulesSession,
  resolveJulesSourceName,
  resolveAutomationMode,
  sanitizeJulesCredential,
} from '@/lib/jules';
import { Blueprint, AcceptanceCriterion, RepoInspectionResult } from '@/types';

interface DispatchRequestBody {
  repo: string;
  baseBranch?: string;
  branchName?: string;
  startingBranch?: string;
  fileBoundaries?: string[] | string;
  objective?: string;
  criteria?: AcceptanceCriterion[];
  customPrompt?: string;
  isRemediation?: boolean;
  prNumber?: number;
  prUrl?: string;
  dryRun?: boolean;
  /** Deep repo grounding for first-pass prompt enrichment (P1). Optional for back-compat. */
  repoContext?: Partial<RepoInspectionResult> | null;
  testCommand?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DispatchRequestBody;

    const {
      repo,
      baseBranch = 'main',
      branchName,
      startingBranch: explicitStartingBranch,
      fileBoundaries = [],
      objective: rawObjective,
      criteria: rawCriteria,
      customPrompt,
      isRemediation = false,
      prNumber,
      dryRun = false,
      repoContext = null,
      testCommand = '',
    } = body;

    if (!repo || !repo.includes('/')) {
      return NextResponse.json(
        { error: 'Invalid repository. Please specify in "owner/repo" format.' },
        { status: 400 }
      );
    }

    const cleanRepo = repo
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');

    // COR-11: remediation must target the audited PR head. Never fall back to
    // 'main', baseBranch, or a generated name — a missing head is a 400.
    const requestedHead = branchName?.trim() || explicitStartingBranch?.trim() || '';
    if (isRemediation && !requestedHead) {
      return NextResponse.json(
        { success: false, error: 'Remediation requires startingBranch = audited PR head' },
        { status: 400 }
      );
    }

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

    if (!objective) {
      return NextResponse.json(
        { error: 'Objective and task description is required.' },
        { status: 400 }
      );
    }

    const criteria: AcceptanceCriterion[] =
      rawCriteria && rawCriteria.length > 0
        ? rawCriteria
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

    if (criteria.length === 0) {
      return NextResponse.json(
        { error: 'At least one Acceptance Criterion is required.' },
        { status: 400 }
      );
    }

    // Extract Jules API key and GitHub PAT from request headers or server environment
    const headerJulesKey = req.headers.get('x-jules-api-key');
    const headerGithubPat = req.headers.get('x-github-pat');
    const julesApiKey =
      sanitizeJulesCredential(headerJulesKey || '') ||
      sanitizeJulesCredential(process.env.JULES_API_KEY || '');
    const githubPat = headerGithubPat?.trim() || process.env.GITHUB_PAT?.trim();

    // Fail-closed check: if not a dryRun, an API key is strictly required
    if (!dryRun && !julesApiKey) {
      return NextResponse.json(
        {
          success: false,
          dryRun: false,
          error:
            'No Google Jules API key configured. Provide an API key via request headers or environment variables, or enable dryRun mode.',
        },
        { status: 401 }
      );
    }

    // Normalize boundaries
    const parsedBoundaries: string[] = Array.isArray(fileBoundaries)
      ? fileBoundaries
      : typeof fileBoundaries === 'string'
      ? fileBoundaries.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    // P0 pre-dispatch gate: fail-closed on structural errors, warn on quality risks.
    // Remediation keeps the legacy path (audit already diagnosed the work).
    let dispatchWarnings: string[] = [];
    if (!isRemediation && !(customPrompt && customPrompt.trim().length > 0)) {
      const treePaths =
        (repoContext as { treePaths?: string[] } | null)?.treePaths ||
        (repoContext?.treePreview as string[] | undefined) ||
        [];
      const gate = preDispatchGate({
        repo: cleanRepo,
        objective: objective.trim(),
        criteria,
        boundaries: parsedBoundaries,
        treePaths,
      });
      if (!gate.ok) {
        return NextResponse.json(
          { success: false, error: gate.errors.join(' '), warnings: gate.warnings },
          { status: 400 }
        );
      }
      dispatchWarnings = gate.warnings;
    }

    const blueprintId = `bp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Compile anti-drift Markdown contract or use custom remediation prompt.
    // First-pass prompts carry repo grounding (stack, files-to-read, test command,
    // explicit DO-NOT list, category + Why, DoD self-check) to maximize one-shot success.
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
              repoContext: isRemediation ? null : repoContext,
              testCommand: isRemediation ? '' : testCommand,
            },
            blueprintId
          );

    // Determine the exact starting branch for Jules
    // For remediation, Jules MUST start and apply changes on the branch being audited
    const effectiveStartingBranch =
      explicitStartingBranch?.trim() ||
      (isRemediation ? targetBranch : undefined) ||
      baseBranch.trim() ||
      'main';

    // Check repository accessibility via GitHub API if token available
    if (githubPat) {
      try {
        const ghCheck = await fetch(`https://api.github.com/repos/${cleanRepo}`, {
          headers: {
            Authorization: `Bearer ${githubPat}`,
            'User-Agent': 'RepoPilot-AuditEngine',
          },
        });
        if (!ghCheck.ok && ghCheck.status !== 404) {
          console.warn(`GitHub check returned status ${ghCheck.status}`);
        }
      } catch (err) {
        console.warn('GitHub accessibility pre-check failed non-fatally:', err);
      }
    }

    // COR-13: sessionId starts undefined. Live responses persist only the exact
    // Jules-returned resource name; dry runs use a dry_-prefixed local id.
    let sessionId: string | undefined = undefined;
    let sessionUrl: string | undefined = undefined;
    let sessionState: string | undefined = undefined;
    let sourceName: string | undefined = undefined;
    let julesApiResponse: unknown = null;

    if (!dryRun && julesApiKey) {
      // Bind owner/repo to a real sources[].name. Fail-closed: never invent a source path.
      const resolvedSource = await resolveJulesSourceName(julesApiKey, cleanRepo);
      if (!resolvedSource.ok) {
        return NextResponse.json(
          {
            success: false,
            dryRun: false,
            error: resolvedSource.error || 'Source not connected in Jules',
            status: resolvedSource.status,
            details: resolvedSource.details,
            repo: cleanRepo,
            targetBranch,
            sourcesListed: resolvedSource.sourcesListed,
            sourcesTruncated: resolvedSource.truncated ?? false,
          },
          { status: resolvedSource.status || 404 }
        );
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
        // Remediation omits automationMode; only first-pass requests AUTO_CREATE_PR.
        ...(automationMode ? { automationMode } : {}),
      });

      if (!julesResult.ok) {
        // Fail-closed invariant: live failures MUST NOT return success: true
        return NextResponse.json(
          {
            success: false,
            dryRun: false,
            error: julesResult.error || `Google Jules API error (HTTP ${julesResult.status})`,
            status: julesResult.status,
            details: julesResult.details,
            repo: cleanRepo,
            targetBranch,
          },
          { status: julesResult.status || 502 }
        );
      }

      if (!julesResult.sessionId) {
        // Fail-closed: a live success without a real Jules id must not persist
        // a fabricated sess_ id on the blueprint.
        return NextResponse.json(
          { success: false, error: 'Jules returned no session id' },
          { status: 502 }
        );
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
      // No PR harvested at dispatch time; populated later via GET /api/jules/session.
      prUrl: undefined,
      prTitle: undefined,
      isRemediation,
    };

    return NextResponse.json({
      success: true,
      dryRun: Boolean(dryRun),
      blueprint: completeBlueprint,
      sessionId,
      sessionUrl,
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
    logRouteError('/api/jules/dispatch', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown dispatch error occurred.',
      },
      { status: 500 }
    );
  }
}
