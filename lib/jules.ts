export const JULES_API_BASE = 'https://jules.googleapis.com/v1alpha';

export type JulesAutomationMode = 'AUTO_CREATE_PR';

export interface JulesSource {
  name: string;
  id?: string;
  githubRepo?: {
    owner?: string;
    repo?: string;
    isPrivate?: boolean;
    defaultBranch?: { displayName?: string };
  };
}

export interface JulesSourcesResult {
  ok: boolean;
  status: number;
  sources: JulesSource[];
  /** True when page-cap was hit with another page still pending. */
  truncated: boolean;
  error?: string;
  details?: unknown;
}

export interface JulesSessionParams {
  apiKey: string;
  /** Full source resource name from GET /v1alpha/sources, e.g. "sources/abc123". */
  sourceName?: string;
  /** owner/repo used to bind sourceName when it is omitted. */
  repo?: string;
  startingBranch: string;
  prompt: string;
  title?: string;
  requirePlanApproval?: boolean;
  automationMode?: JulesAutomationMode;
  fetchFn?: typeof fetch;
}

export interface JulesSessionResult {
  ok: boolean;
  status: number;
  sessionId?: string;
  sessionUrl?: string;
  state?: string;
  data?: Record<string, unknown>;
  error?: string;
  details?: unknown;
}

export interface JulesSessionSnapshot {
  ok: boolean;
  status: number;
  sessionId?: string;
  sessionUrl?: string;
  state?: string;
  prUrl?: string;
  prTitle?: string;
  data?: Record<string, unknown>;
  error?: string;
  details?: unknown;
}

export interface ResolvedJulesSource {
  ok: boolean;
  status: number;
  sourceName?: string;
  source?: JulesSource;
  /** How many sources were listed while binding (diagnostics only). */
  sourcesListed?: number;
  truncated?: boolean;
  error?: string;
  details?: unknown;
}

export function normalizeRepoSlug(repo: string): string {
  return repo
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

/**
 * Picks the Jules source whose connected GitHub repo matches `repo`.
 * Compares githubRepo.owner/repo, then id, then the resource name suffix.
 * Returns the object unchanged so callers use the exact sources[].name.
 * Returns null when the repo is not in the Jules allowlist.
 */
export function findJulesSource(sources: JulesSource[], repo: string): JulesSource | null {
  const target = normalizeRepoSlug(repo);
  if (!target) return null;

  const stripPrefixes = (value: string): string =>
    (value || '').replace(/^sources\//i, '').replace(/^github\//i, '').toLowerCase();

  return (
    sources.find((source) => {
      const owner = (source.githubRepo?.owner || '').trim();
      const repoName = (source.githubRepo?.repo || '').trim();
      if (owner && repoName) {
        if (`${owner}/${repoName}`.toLowerCase() === target) return true;
      }
      const id = (source.id || '').trim();
      if (id && (id.toLowerCase() === target || stripPrefixes(id) === target)) return true;
      const name = (source.name || '').trim();
      if (!name) return false;
      // Exact name match (e.g. "sources/src_abc" won't match "owner/repo").
      if (name.toLowerCase() === target) return true;
      return stripPrefixes(name) === target;
    }) || null
  );
}

/**
 * Remediation sessions push commits onto the audited branch of an existing PR,
 * so the automationMode key is omitted. Only the first-pass session may open
 * a new pull request.
 */
export function resolveAutomationMode(isRemediation: boolean): JulesAutomationMode | undefined {
  return isRemediation ? undefined : 'AUTO_CREATE_PR';
}

function julesHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': apiKey.trim(),
    'User-Agent': 'RepoPilot/1.0',
  };
}

async function readErrorBody(response: Response): Promise<{ message: string; raw: unknown }> {
  const fallback = `Google Jules API returned HTTP ${response.status}`;
  try {
    const errJson = (await response.json()) as { error?: { message?: string } };
    if (errJson?.error?.message) return { message: errJson.error.message, raw: errJson };
    return { message: fallback, raw: errJson };
  } catch {
    const rawText = await response.text().catch(() => '');
    if (rawText) return { message: rawText.slice(0, 300), raw: rawText };
    return { message: fallback, raw: null };
  }
}

/** Lists repositories connected to the caller's Jules workspace.
 * The API defaults to 30 sources per page, so all pages are followed
 * (pageSize=100, capped at MAX_SOURCE_PAGES) — otherwise repos past the
 * first page would silently fail to bind at dispatch time. */
export const MAX_SOURCE_PAGES = 10;

export async function listJulesSources(
  apiKey: string,
  fetchFn?: typeof fetch
): Promise<JulesSourcesResult> {
  if (!apiKey || !apiKey.trim()) {
    return {
      ok: false,
      status: 401,
      sources: [],
      truncated: false,
      error: 'Missing Google Jules API key. Provide an API key or use dryRun mode.',
    };
  }

  const _fetch = fetchFn ?? globalThis.fetch;
  const sources: JulesSource[] = [];
  let pageToken: string | undefined;
  let status = 200;

  try {
    for (let page = 0; page < MAX_SOURCE_PAGES; page += 1) {
      const url =
        `${JULES_API_BASE}/sources?pageSize=100` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const response = await _fetch(url, {
        method: 'GET',
        headers: julesHeaders(apiKey),
      });

      if (!response.ok) {
        const { message, raw } = await readErrorBody(response);
        return { ok: false, status: response.status, sources: [], truncated: false, error: message, details: raw };
      }

      status = response.status;
      const data = (await response.json()) as { sources?: JulesSource[]; nextPageToken?: string };
      if (Array.isArray(data.sources)) sources.push(...data.sources);

      pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : undefined;
      if (!pageToken) {
        return { ok: true, status, sources, truncated: false };
      }
    }

    return { ok: true, status, sources, truncated: true };
  } catch (networkError) {
    return {
      ok: false,
      status: 502,
      sources: [],
      truncated: false,
      error:
        networkError instanceof Error
          ? networkError.message
          : 'Network error connecting to Google Jules API',
      details: networkError,
    };
  }
}

/**
 * Binds `owner/repo` to a real `sources[].name` returned by the Jules API.
 * Fail-closed: an unlisted repository yields ok:false so dispatch never invents a source.
 */
export async function resolveJulesSourceName(
  apiKey: string,
  repo: string,
  fetchFn?: typeof fetch
): Promise<ResolvedJulesSource> {
  const listed = await listJulesSources(apiKey, fetchFn);
  if (!listed.ok) {
    return {
      ok: false,
      status: listed.status,
      sourcesListed: 0,
      truncated: listed.truncated,
      error: listed.error,
      details: listed.details,
    };
  }

  const match = findJulesSource(listed.sources, repo);
  if (!match?.name) {
    return {
      ok: false,
      status: 404,
      sourcesListed: listed.sources.length,
      truncated: listed.truncated,
      error: 'Source not connected in Jules',
    };
  }

  return { ok: true, status: 200, sourceName: match.name, source: match, sourcesListed: listed.sources.length, truncated: listed.truncated };
}

/**
 * Creates an asynchronous coding session with Google Jules.
 * Fail-closed: 401/404/400 responses never resolve to success.
 */
export async function createJulesSession(params: JulesSessionParams): Promise<JulesSessionResult> {
  const {
    apiKey,
    sourceName,
    repo,
    startingBranch,
    prompt,
    title,
    requirePlanApproval = false,
    automationMode,
    fetchFn,
  } = params;
  const _fetch = fetchFn ?? globalThis.fetch;

  if (!apiKey || !apiKey.trim()) {
    return {
      ok: false,
      status: 401,
      error: 'Missing Google Jules API key. Provide an API key or use dryRun mode.',
    };
  }

  let resolvedSource = sourceName?.trim() || '';
  if (!resolvedSource) {
    if (!repo?.trim()) {
      return {
        ok: false,
        status: 404,
        error: 'Source not connected in Jules',
      };
    }
    const listed = await listJulesSources(apiKey, _fetch);
    if (!listed.ok) {
      return {
        ok: false,
        status: listed.status,
        error: listed.error,
        details: listed.details,
      };
    }
    const match = findJulesSource(listed.sources, repo);
    if (!match?.name) {
      return {
        ok: false,
        status: 404,
        error: 'Source not connected in Jules',
      };
    }
    resolvedSource = match.name;
  }

  const sessionPayload: Record<string, unknown> = {
    prompt,
    title,
    sourceContext: {
      source: resolvedSource,
      githubRepoContext: {
        startingBranch,
      },
    },
    requirePlanApproval,
    ...(automationMode ? { automationMode } : {}),
  };

  try {
    const response = await _fetch(`${JULES_API_BASE}/sessions`, {
      method: 'POST',
      headers: julesHeaders(apiKey),
      body: JSON.stringify(sessionPayload),
    });

    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>;
      const rawName =
        (typeof data.name === 'string' ? data.name : '') ||
        (typeof data.id === 'string' ? data.id : '') ||
        '';
      const sessionNumericId = rawName.replace(/^sessions\//, '');
      const sessionUrl =
        typeof data.url === 'string' && data.url
          ? data.url
          : sessionNumericId
          ? `https://jules.google.com/session/${sessionNumericId}`
          : undefined;

      return {
        ok: true,
        status: response.status,
        sessionId: rawName || sessionNumericId,
        sessionUrl,
        state: typeof data.state === 'string' ? data.state : undefined,
        data: {
          ...data,
          numericId: sessionNumericId,
          url: sessionUrl,
        },
      };
    }

    const { message, raw } = await readErrorBody(response);
    return { ok: false, status: response.status, error: message, details: raw };
  } catch (networkError) {
    return {
      ok: false,
      status: 502,
      error:
        networkError instanceof Error
          ? networkError.message
          : 'Network error connecting to Google Jules API',
      details: networkError,
    };
  }
}

/** Pulls the pull request output off a Jules session payload, if the agent opened one. */
export function harvestPullRequest(session: Record<string, unknown>): {
  url?: string;
  title?: string;
} {
  const outputs = session?.outputs;
  if (!Array.isArray(outputs)) return {};

  for (const output of outputs) {
    const pr = (output as { pullRequest?: { url?: string; title?: string } } | null)?.pullRequest;
    if (pr && typeof pr.url === 'string' && pr.url) {
      return { url: pr.url, title: typeof pr.title === 'string' ? pr.title : undefined };
    }
  }
  return {};
}

/** Reads a Jules session back, harvesting its state and any PR it opened. */
export async function getJulesSession(
  apiKey: string,
  sessionId: string,
  fetchFn?: typeof fetch
): Promise<JulesSessionSnapshot> {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, status: 401, error: 'Missing Google Jules API key.' };
  }

  const numericId = sessionId.trim().replace(/^sessions\//, '');
  if (!numericId) {
    return { ok: false, status: 400, error: 'Session ID is required to read a Jules session.' };
  }

  try {
    const _fetch = fetchFn ?? globalThis.fetch;
    const response = await _fetch(`${JULES_API_BASE}/sessions/${numericId}`, {
      method: 'GET',
      headers: julesHeaders(apiKey),
    });

    if (!response.ok) {
      const { message, raw } = await readErrorBody(response);
      return { ok: false, status: response.status, error: message, details: raw };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const rawName = typeof data.name === 'string' ? data.name : numericId;
    const harvested = harvestPullRequest(data);

    return {
      ok: true,
      status: response.status,
      sessionId: rawName,
      sessionUrl: typeof data.url === 'string' && data.url ? data.url : undefined,
      state: typeof data.state === 'string' ? data.state : undefined,
      prUrl: harvested.url,
      prTitle: harvested.title,
      data,
    };
  } catch (networkError) {
    return {
      ok: false,
      status: 502,
      error:
        networkError instanceof Error
          ? networkError.message
          : 'Network error connecting to Google Jules API',
      details: networkError,
    };
  }
}
