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

/** Strips quotes, `Bearer ` prefixes, and paste whitespace from a Jules credential. */
export function sanitizeJulesCredential(raw: string): string {
  let key = (raw || '').trim();
  if (
    (key.startsWith('"') && key.endsWith('"') && key.length >= 2) ||
    (key.startsWith("'") && key.endsWith("'") && key.length >= 2)
  ) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/^Bearer\s+/i, '').trim();
  return key.replace(/\s+/g, '');
}

export type JulesAuthScheme = 'api-key' | 'bearer';

/**
 * Jules REST docs use `x-goog-api-key`. Google authorization keys (AQ.) and
 * OAuth access tokens must go in `Authorization: Bearer` because they assert a
 * principal; sending them as an API key yields HTTP 401 "API keys are not supported".
 */
export function preferredJulesAuthScheme(key: string): JulesAuthScheme {
  const k = sanitizeJulesCredential(key);
  if (!k) return 'api-key';
  if (/^ya29[.\-_]/i.test(k) || k.startsWith('eyJ')) return 'bearer';
  if (/^AQ[.\-_]/i.test(k)) return 'bearer';
  return 'api-key';
}

export function isJulesPrincipalAuthError(message: string): boolean {
  return (
    /API keys are not supported/i.test(message) ||
    /assert a principal/i.test(message) ||
    /ACCESS_TOKEN_TYPE_UNSUPPORTED/i.test(message)
  );
}

function rewriteJulesError(message: string): string {
  if (!isJulesPrincipalAuthError(message)) return message;
  return (
    `${message} This credential did not assert a Jules user identity. ` +
    `Use a Jules API key from https://jules.google.com/settings — not a Gemini, Google AI Studio, or Cloud Console API key. ` +
    `OAuth tokens and AQ. authorization keys are retried automatically with Bearer auth.`
  );
}

/** Resource names the official SDK and Jules docs use for a GitHub repo. */
export function candidateSourceResourceNames(repo: string): string[] {
  const cleaned = repo
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const [owner, name] = cleaned.split('/');
  if (!owner || !name) return [];

  const seen = new Set<string>();
  const names: string[] = [];
  const push = (value: string) => {
    if (!seen.has(value)) {
      seen.add(value);
      names.push(value);
    }
  };

  const pairs: Array<[string, string]> = [[owner, name]];
  const lowerOwner = owner.toLowerCase();
  const lowerName = name.toLowerCase();
  if (lowerOwner !== owner || lowerName !== name) pairs.push([lowerOwner, lowerName]);

  for (const [o, n] of pairs) {
    push(`sources/github/${o}/${n}`);
    push(`sources/github-${o}-${n}`);
    push(`sources/${o}/${n}`);
  }
  return names;
}

/**
 * Picks the Jules source whose connected GitHub repo matches `repo`.
 * Compares githubRepo.owner/repo, then id, then the resource name suffix
 * (slash form and hyphenated `github-owner-repo` form from Jules docs).
 * Returns the object unchanged so callers use the exact sources[].name.
 * Returns null when the repo is not in the Jules allowlist.
 */
export function findJulesSource(sources: JulesSource[], repo: string): JulesSource | null {
  const target = normalizeRepoSlug(repo);
  if (!target) return null;

  const stripPrefixes = (value: string): string =>
    (value || '').replace(/^sources\//i, '').replace(/^github\//i, '').toLowerCase();
  const hyphenTarget = target.replace('/', '-');
  const githubHyphenTarget = `github-${hyphenTarget}`;

  const matchesToken = (raw: string): boolean => {
    const value = (raw || '').trim();
    if (!value) return false;
    const lower = value.toLowerCase();
    const stripped = stripPrefixes(value);
    return (
      lower === target ||
      stripped === target ||
      stripped === hyphenTarget ||
      stripped === githubHyphenTarget ||
      lower === githubHyphenTarget
    );
  };

  return (
    sources.find((source) => {
      const owner = (source.githubRepo?.owner || '').trim();
      const repoName = (source.githubRepo?.repo || '').trim();
      if (owner && repoName) {
        if (`${owner}/${repoName}`.toLowerCase() === target) return true;
      }
      if (matchesToken(source.id || '')) return true;
      const name = (source.name || '').trim();
      if (!name) return false;
      return matchesToken(name);
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

function julesHeaders(apiKey: string, scheme: JulesAuthScheme): Record<string, string> {
  const key = sanitizeJulesCredential(apiKey);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'RepoPilot/1.0',
  };
  if (scheme === 'bearer') {
    headers.Authorization = `Bearer ${key}`;
  } else {
    // Official Jules REST header (docs and @google/jules-sdk).
    headers['x-goog-api-key'] = key;
  }
  return headers;
}

async function readErrorBody(response: Response): Promise<{ message: string; raw: unknown }> {
  const fallback = `Google Jules API returned HTTP ${response.status}`;
  try {
    const errJson = (await response.json()) as { error?: { message?: string } };
    if (errJson?.error?.message) {
      return { message: rewriteJulesError(errJson.error.message), raw: errJson };
    }
    return { message: fallback, raw: errJson };
  } catch {
    const rawText = await response.text().catch(() => '');
    if (rawText) return { message: rewriteJulesError(rawText.slice(0, 300)), raw: rawText };
    return { message: fallback, raw: null };
  }
}

function asJulesSource(data: unknown): JulesSource | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  if (Array.isArray(rec.sources)) return null;
  if (typeof rec.name !== 'string' || !rec.name.startsWith('sources/')) return null;
  return rec as unknown as JulesSource;
}

/**
 * Sends a Jules request with the credential scheme that matches the key type.
 * If Google replies that API keys cannot assert a principal, retries once with
 * the opposite scheme (Bearer <-> x-goog-api-key).
 */
async function julesFetch(
  url: string,
  apiKey: string,
  init: RequestInit,
  fetchFn: typeof fetch
): Promise<Response> {
  const key = sanitizeJulesCredential(apiKey);
  const primary = preferredJulesAuthScheme(key);
  const baseInit: RequestInit = { cache: 'no-store', ...init };

  const first = await fetchFn(url, {
    ...baseInit,
    headers: { ...julesHeaders(key, primary), ...(init.headers as Record<string, string> | undefined) },
  });
  if (first.ok || (first.status !== 401 && first.status !== 403)) return first;

  let message = '';
  if (typeof first.clone === 'function') {
    try {
      message = (await readErrorBody(first.clone())).message;
    } catch {
      message = '';
    }
  }
  const retryAsBearer = primary === 'api-key' && isJulesPrincipalAuthError(message);
  const retryAsApiKey =
    primary === 'bearer' && /API key not valid|invalid authentication credentials/i.test(message);
  if (!retryAsBearer && !retryAsApiKey) return first;

  const fallback: JulesAuthScheme = primary === 'api-key' ? 'bearer' : 'api-key';
  return fetchFn(url, {
    ...baseInit,
    headers: { ...julesHeaders(key, fallback), ...(init.headers as Record<string, string> | undefined) },
  });
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
  const key = sanitizeJulesCredential(apiKey);
  if (!key) {
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
      const response = await julesFetch(url, key, { method: 'GET' }, _fetch);

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

export interface JulesSourceGetResult {
  ok: boolean;
  status: number;
  source?: JulesSource;
  error?: string;
  details?: unknown;
}

/** GET /v1alpha/{name=sources/**} — same path the official Jules SDK uses. */
export async function getJulesSource(
  apiKey: string,
  resourceName: string,
  fetchFn?: typeof fetch
): Promise<JulesSourceGetResult> {
  const key = sanitizeJulesCredential(apiKey);
  if (!key) {
    return { ok: false, status: 401, error: 'Missing Google Jules API key. Provide an API key or use dryRun mode.' };
  }

  const name = resourceName.trim().replace(/^\//, '');
  if (!name.startsWith('sources/')) {
    return { ok: false, status: 400, error: 'Source resource name is required.' };
  }

  try {
    const _fetch = fetchFn ?? globalThis.fetch;
    const response = await julesFetch(`${JULES_API_BASE}/${name}`, key, { method: 'GET' }, _fetch);
    if (!response.ok) {
      const { message, raw } = await readErrorBody(response);
      return { ok: false, status: response.status, error: message, details: raw };
    }

    const data: unknown = await response.json();
    const source = asJulesSource(data);
    if (!source?.name) {
      return { ok: false, status: 404, error: 'Source not connected in Jules' };
    }
    return { ok: true, status: response.status, source };
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

/**
 * Binds `owner/repo` to a real `sources[].name`.
 * Tries GET `sources/github/{owner}/{repo}` first (official SDK), then lists.
 * Fail-closed: never invents a source path.
 */
export async function resolveJulesSourceName(
  apiKey: string,
  repo: string,
  fetchFn?: typeof fetch
): Promise<ResolvedJulesSource> {
  const key = sanitizeJulesCredential(apiKey);
  if (!key) {
    return {
      ok: false,
      status: 401,
      error: 'Missing Google Jules API key. Provide an API key or use dryRun mode.',
    };
  }

  for (const resourceName of candidateSourceResourceNames(repo)) {
    const got = await getJulesSource(key, resourceName, fetchFn);
    if (got.ok && got.source?.name && findJulesSource([got.source], repo)) {
      return {
        ok: true,
        status: 200,
        sourceName: got.source.name,
        source: got.source,
        sourcesListed: 1,
      };
    }
    if (!got.ok && (got.status === 401 || got.status === 403)) {
      return {
        ok: false,
        status: got.status,
        error: got.error,
        details: got.details,
      };
    }
  }

  const listed = await listJulesSources(key, fetchFn);
  if (!listed.ok) {
    return {
      ok: false,
      status: listed.status,
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

  return {
    ok: true,
    status: 200,
    sourceName: match.name,
    source: match,
    sourcesListed: listed.sources.length,
    truncated: listed.truncated,
  };
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
  const key = sanitizeJulesCredential(apiKey);

  if (!key) {
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
    const bound = await resolveJulesSourceName(key, repo, _fetch);
    if (!bound.ok || !bound.sourceName) {
      return {
        ok: false,
        status: bound.status,
        error: bound.error,
        details: bound.details,
      };
    }
    resolvedSource = bound.sourceName;
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
    const response = await julesFetch(
      `${JULES_API_BASE}/sessions`,
      key,
      {
        method: 'POST',
        body: JSON.stringify(sessionPayload),
      },
      _fetch
    );

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

export interface SendJulesMessageParams {
  apiKey: string;
  sessionId: string;
  prompt: string;
  fetchFn?: typeof fetch;
}

export interface SendJulesMessageResult {
  ok: boolean;
  status: number;
  sessionId?: string;
  sessionUrl?: string;
  state?: string;
  data?: Record<string, unknown>;
  error?: string;
  details?: unknown;
}

/**
 * Sends a follow-up message to an existing Jules session.
 * Official path: POST /v1alpha/sessions/{id}:sendMessage with { prompt }.
 * A successful response body is empty. Fail-closed: 401/400/404 never resolve
 * to success. Never creates a session and never sets automationMode.
 */
export async function sendJulesMessage(
  params: SendJulesMessageParams
): Promise<SendJulesMessageResult> {
  const { apiKey, sessionId, prompt, fetchFn } = params;
  const _fetch = fetchFn ?? globalThis.fetch;
  const key = sanitizeJulesCredential(apiKey);

  if (!key) {
    return { ok: false, status: 401, error: 'Missing Google Jules API key.' };
  }

  const numericId = (sessionId || '').trim().replace(/^sessions\//, '');
  if (!numericId) {
    return { ok: false, status: 400, error: 'Session ID is required to message a Jules session.' };
  }

  if (!prompt || !prompt.trim()) {
    return { ok: false, status: 400, error: 'Prompt is required to message a Jules session.' };
  }

  try {
    const response = await julesFetch(
      `${JULES_API_BASE}/sessions/${numericId}:sendMessage`,
      key,
      {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      },
      _fetch
    );

    if (!response.ok) {
      const { message, raw } = await readErrorBody(response);
      return { ok: false, status: response.status, error: message, details: raw };
    }

    const rawText = await response.text().catch(() => '');
    let data: Record<string, unknown> = {};
    if (rawText.trim()) {
      try {
        data = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        data = { raw: rawText.slice(0, 300) };
      }
    }

    const rawName = typeof data.name === 'string' && data.name ? data.name : `sessions/${numericId}`;
    const sessionUrl =
      typeof data.url === 'string' && data.url
        ? data.url
        : `https://jules.google.com/session/${numericId}`;

    return {
      ok: true,
      status: response.status,
      sessionId: rawName,
      sessionUrl,
      state: typeof data.state === 'string' ? data.state : undefined,
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

/** Reads a Jules session back, harvesting its state and any PR it opened. */
export async function getJulesSession(
  apiKey: string,
  sessionId: string,
  fetchFn?: typeof fetch
): Promise<JulesSessionSnapshot> {
  const key = sanitizeJulesCredential(apiKey);
  if (!key) {
    return { ok: false, status: 401, error: 'Missing Google Jules API key.' };
  }

  const numericId = sessionId.trim().replace(/^sessions\//, '');
  if (!numericId) {
    return { ok: false, status: 400, error: 'Session ID is required to read a Jules session.' };
  }

  try {
    const _fetch = fetchFn ?? globalThis.fetch;
    const response = await julesFetch(
      `${JULES_API_BASE}/sessions/${numericId}`,
      key,
      { method: 'GET' },
      _fetch
    );

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
