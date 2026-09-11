import { NextRequest, NextResponse } from 'next/server';
import { compileJulesPrompt } from '@/lib/prompt-compiler';
import { createJulesSession } from '@/lib/jules';
import { Blueprint, AcceptanceCriterion } from '@/types';

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

    const targetBranch =
      branchName?.trim() ||
      explicitStartingBranch?.trim() ||
      (isRemediation
        ? 'main'
        : `jules/${(rawObjective || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}-${Math.floor(
            1000 + Math.random() * 9000
          )}`);

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
    const julesApiKey = headerJulesKey?.trim() || process.env.JULES_API_KEY?.trim();
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

    const blueprintId = `bp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Compile anti-drift Markdown contract or use custom remediation prompt
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

    let sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    let sessionUrl: string | undefined = undefined;
    let julesApiResponse: unknown = null;

    if (!dryRun && julesApiKey) {
      const sessionTitle = `[RepoPilot] ${objective.slice(0, 80)}`;
      const julesResult = await createJulesSession({
        apiKey: julesApiKey,
        repo: cleanRepo,
        startingBranch: effectiveStartingBranch,
        prompt: compiledPrompt,
        title: sessionTitle,
        requirePlanApproval: false,
        automationMode: 'AUTO_CREATE_PR',
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

      sessionId = julesResult.sessionId || sessionId;
      sessionUrl = julesResult.sessionUrl;
      julesApiResponse = julesResult.data;
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
    });
  } catch (error) {
    console.error('Error in /api/jules/dispatch:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown dispatch error occurred.',
      },
      { status: 500 }
    );
  }
}
