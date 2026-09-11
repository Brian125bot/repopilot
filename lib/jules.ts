export interface JulesSessionParams {
  apiKey: string;
  repo: string;
  startingBranch: string;
  prompt: string;
  title?: string;
  requirePlanApproval?: boolean;
  automationMode?: 'AUTO_CREATE_PR' | 'AUTOMATION_MODE_UNSPECIFIED' | string;
}

export interface JulesSessionResult {
  ok: boolean;
  status: number;
  sessionId?: string;
  sessionUrl?: string;
  data?: Record<string, unknown>;
  error?: string;
  details?: unknown;
}

/**
 * Creates an asynchronous coding session with Google Jules API.
 * Encapsulates the complete v1alpha/sessions schema and provides fail-closed error handling.
 */
export async function createJulesSession(params: JulesSessionParams): Promise<JulesSessionResult> {
  const {
    apiKey,
    repo,
    startingBranch,
    prompt,
    title,
    requirePlanApproval = false,
    automationMode = 'AUTO_CREATE_PR',
  } = params;

  if (!apiKey || !apiKey.trim()) {
    return {
      ok: false,
      status: 401,
      error: 'Missing Google Jules API key. Provide an API key or use dryRun mode.',
    };
  }

  const cleanRepo = repo
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

  const sessionPayload = {
    prompt,
    title: title || `[RepoPilot] ${cleanRepo}`,
    sourceContext: {
      source: `sources/github/${cleanRepo}`,
      githubRepoContext: {
        startingBranch,
      },
    },
    requirePlanApproval,
    automationMode,
  };

  try {
    const response = await fetch('https://jules.googleapis.com/v1alpha/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey.trim(),
        'User-Agent': 'RepoPilot/1.0',
      },
      body: JSON.stringify(sessionPayload),
    });

    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>;
      const rawName = (typeof data.name === 'string' ? data.name : '') ||
        (typeof data.id === 'string' ? data.id : '') ||
        (typeof data.sessionId === 'string' ? data.sessionId : '');
      const sessionNumericId = rawName.replace(/^sessions\//, '');
      const sessionUrl = sessionNumericId ? `https://jules.google.com/session/${sessionNumericId}` : undefined;

      return {
        ok: true,
        status: response.status,
        sessionId: rawName || sessionNumericId,
        sessionUrl,
        data: {
          ...data,
          numericId: sessionNumericId,
          url: sessionUrl,
        },
      };
    }

    let errorMsg = `Google Jules API returned HTTP ${response.status}`;
    let rawErrorBody: unknown = null;
    try {
      const errJson = await response.json();
      rawErrorBody = errJson;
      if (errJson?.error?.message) {
        errorMsg = errJson.error.message;
      }
    } catch {
      const rawText = await response.text().catch(() => '');
      if (rawText) {
        errorMsg = rawText.slice(0, 300);
        rawErrorBody = rawText;
      }
    }

    return {
      ok: false,
      status: response.status,
      error: errorMsg,
      details: rawErrorBody,
    };
  } catch (networkError) {
    return {
      ok: false,
      status: 502,
      error: networkError instanceof Error ? networkError.message : 'Network error connecting to Google Jules API',
      details: networkError,
    };
  }
}
