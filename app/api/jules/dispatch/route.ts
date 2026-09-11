import { NextRequest, NextResponse } from 'next/server';
import { compileJulesPrompt } from '@/lib/prompt-compiler';
import { Blueprint, AcceptanceCriterion } from '@/types';

interface DispatchRequestBody {
  repo: string;
  baseBranch?: string;
  branchName?: string;
  fileBoundaries?: string[] | string;
  objective: string;
  criteria: AcceptanceCriterion[];
  dryRun?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DispatchRequestBody;

    const {
      repo,
      baseBranch = 'main',
      branchName,
      fileBoundaries = [],
      objective,
      criteria,
      dryRun = false,
    } = body;

    if (!repo || !repo.includes('/')) {
      return NextResponse.json(
        { error: 'Invalid repository. Please specify in "owner/repo" format.' },
        { status: 400 }
      );
    }

    if (!objective || objective.trim().length === 0) {
      return NextResponse.json(
        { error: 'Objective and task description is required.' },
        { status: 400 }
      );
    }

    if (!criteria || criteria.length === 0) {
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

    // Clean repository name (strip full github.com URL or .git suffix if provided)
    const cleanRepo = repo
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');

    // Normalize boundaries
    const parsedBoundaries: string[] = Array.isArray(fileBoundaries)
      ? fileBoundaries
      : typeof fileBoundaries === 'string'
      ? fileBoundaries.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const targetBranch =
      branchName?.trim() ||
      `jules/${objective.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}-${Math.floor(
        1000 + Math.random() * 9000
      )}`;

    const blueprintId = `bp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Compile anti-drift Markdown contract
    const compiledPrompt = compileJulesPrompt(
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

    // Google Jules API Payload using official sourceContext structure
    const julesPayload = {
      prompt: compiledPrompt,
      sourceContext: {
        source: `sources/github/${cleanRepo}`,
        githubRepoContext: {
          startingBranch: baseBranch.trim() || 'main',
        },
      },
    };

    let sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    let apiStatus: 'DISPATCHED_TO_JULES' | 'LOCAL_DRY_RUN' | 'JULES_API_FALLBACK' = 'LOCAL_DRY_RUN';
    let julesApiResponse: unknown = null;
    let warningMessage: string | undefined = undefined;

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

    if (!dryRun && julesApiKey) {
      try {
        const julesEndpoint = 'https://jules.googleapis.com/v1alpha/sessions';
        const response = await fetch(julesEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': julesApiKey,
            'User-Agent': 'RepoPilot/1.0',
          },
          body: JSON.stringify(julesPayload),
        });

        if (response.ok) {
          const data = await response.json();
          sessionId = data.name || data.id || data.sessionId || sessionId;
          const sessionNumericId = (data.name || '').replace(/^sessions\//, '') || data.id || '';
          const sessionUrl = sessionNumericId
            ? `https://jules.google.com/session/${sessionNumericId}`
            : undefined;

          julesApiResponse = {
            ...data,
            url: sessionUrl,
            numericId: sessionNumericId,
          };
          apiStatus = 'DISPATCHED_TO_JULES';
        } else {
          let errorMsg = `Google Jules API returned HTTP ${response.status}`;
          let rawErrorBody: unknown = null;
          try {
            const errJson = await response.json();
            rawErrorBody = errJson;
            if (errJson.error?.message) {
              errorMsg = errJson.error.message;
            }
          } catch {
            const rawText = await response.text().catch(() => '');
            if (rawText) {
              errorMsg = rawText.slice(0, 200);
              rawErrorBody = rawText;
            }
          }

          console.warn(`Google Jules API dispatch error (${response.status}):`, errorMsg);
          apiStatus = 'JULES_API_FALLBACK';
          julesApiResponse = {
            status: response.status,
            error: errorMsg,
            details: rawErrorBody,
          };

          if (response.status === 401 || response.status === 403 || errorMsg.toLowerCase().includes('api key')) {
            warningMessage = `Jules API rejected credentials (HTTP ${response.status}: ${errorMsg}). Verify that you provided a valid Google Jules API key from jules.google.com/settings (distinct from Gemini API keys). The blueprint has been compiled and saved locally.`;
          } else if (response.status === 404 || errorMsg.toLowerCase().includes('source') || errorMsg.toLowerCase().includes('not found')) {
            warningMessage = `Repository source not found in Jules (HTTP ${response.status}: ${errorMsg}). Ensure the Jules GitHub App is installed for "${cleanRepo}" at jules.google.com before dispatching. Blueprint saved to vault.`;
          } else {
            warningMessage = `Jules API returned ${response.status}: ${errorMsg}. Blueprint compiled and recorded locally.`;
          }
        }
      } catch (err) {
        console.warn('Google Jules API network call failed:', err);
        apiStatus = 'JULES_API_FALLBACK';
        warningMessage = `Network error connecting to Google Jules API (${err instanceof Error ? err.message : 'connection refused'}). Blueprint preserved in vault for manual dispatch.`;
      }
    } else if (!julesApiKey && !dryRun) {
      apiStatus = 'LOCAL_DRY_RUN';
      warningMessage =
        'No Google Jules API key configured. Dispatch was saved locally as a blueprint. To dispatch directly to the Jules asynchronous agent, configure your Jules API key from jules.google.com/settings in the Settings panel (or set JULES_API_KEY).';
    }

    const completeBlueprint: Blueprint = {
      blueprintId,
      repo: repo.trim(),
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
      blueprint: completeBlueprint,
      sessionId,
      targetBranch,
      repo: repo.trim(),
      baseBranch: baseBranch.trim(),
      apiStatus,
      warningMessage,
      julesApiResponse,
      githubUrl: `https://github.com/${repo.trim()}`,
      dispatchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in /api/jules/dispatch:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown dispatch error occurred.',
      },
      { status: 500 }
    );
  }
}
