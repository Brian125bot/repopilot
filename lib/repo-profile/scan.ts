import { ConventionEntry, RepoProfile, STEERING_SCHEMA_VERSION } from '@/lib/types/steering';
import {
  parsePackageJson,
  detectPackageManagerFromFiles,
  parseCommitMessages,
  parseLintAndFormatConfigs,
  GitHubCommitItem,
} from './parsers';

export interface ScanOptions {
  owner: string;
  repo: string;
  pat?: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgressInfo) => void;
  fetchFn?: typeof fetch;
}

export interface ScanProgressInfo {
  step: 'repo' | 'contents' | 'commits' | 'configs' | 'complete' | 'cancelled' | 'error';
  message: string;
  completedSteps: number;
  totalSteps: number;
}

export interface ScanResult {
  profile: RepoProfile;
  incomplete: boolean;
  errors: string[];
}

function githubHeaders(pat?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'RepoPilot-RepoProfileScanner',
  };
  if (pat && pat.trim()) {
    headers.Authorization = `Bearer ${pat.trim()}`;
  }
  return headers;
}

/**
 * Fetch wrapper with 403 backoff (max 1 retry) and AbortSignal support.
 */
async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
  customFetch: typeof fetch = fetch
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  if (signal?.aborted) {
    throw new DOMException('Scan aborted by user', 'AbortError');
  }

  const doFetch = async () => {
    const res = await customFetch(url, { headers, signal, cache: 'no-store' });
    return res;
  };

  try {
    let res = await doFetch();

    // 403 retry with backoff (max 1 retry) if not aborted
    if (res.status === 403 && !signal?.aborted) {
      await new Promise((r) => setTimeout(r, 1000));
      if (signal?.aborted) {
        throw new DOMException('Scan aborted by user', 'AbortError');
      }
      res = await doFetch();
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, status: res.status, data: null, error: errText || `HTTP ${res.status}` };
    }

    const data = await res.json().catch(() => null);
    return { ok: true, status: res.status, data };
  } catch (err: any) {
    if (err.name === 'AbortError' || signal?.aborted) {
      throw err;
    }
    return { ok: false, status: 0, data: null, error: err.message || 'Fetch failed' };
  }
}

export async function scanRepository(options: ScanOptions): Promise<ScanResult> {
  const { owner, repo, pat, signal, onProgress, fetchFn = fetch } = options;
  const headers = githubHeaders(pat);
  const errors: string[] = [];
  let incomplete = false;

  const totalSteps = 4;
  let completedSteps = 0;

  const updateProgress = (
    step: ScanProgressInfo['step'],
    message: string
  ) => {
    if (onProgress) {
      onProgress({ step, message, completedSteps, totalSteps });
    }
  };

  // Helper to check abort signal before actions
  const checkAborted = () => {
    if (signal?.aborted) {
      throw new DOMException('Scan aborted by user', 'AbortError');
    }
  };

  // Defaults for stack and profile
  let defaultBranch = 'main';
  let packageManager: string | undefined;
  let testRunner: string | undefined;
  let framework: string | undefined;
  const languagesSet = new Set<string>();
  const conventions: ConventionEntry[] = [];
  let customInstructions = '';

  // Step 1: Repo Metadata
  try {
    checkAborted();
    updateProgress('repo', `Fetching metadata for ${owner}/${repo}...`);
    const repoRes = await fetchWithRetry(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      headers,
      signal,
      fetchFn
    );

    if (repoRes.ok && repoRes.data) {
      if (repoRes.data.default_branch) {
        defaultBranch = repoRes.data.default_branch;
      }
      if (repoRes.data.language) {
        languagesSet.add(repoRes.data.language);
      }
    } else {
      errors.push(`Failed to fetch repo metadata: ${repoRes.error || repoRes.status}`);
      incomplete = true;
    }
  } catch (err: any) {
    if (err.name === 'AbortError' || signal?.aborted) {
      return buildPartialProfile({
        owner,
        repo,
        defaultBranch,
        packageManager,
        testRunner,
        framework,
        languages: Array.from(languagesSet),
        conventions,
        customInstructions: customInstructions || 'Scan cancelled by operator.',
        errors: [...errors, 'Scan cancelled during metadata fetch.'],
      });
    }
    errors.push(`Repo metadata error: ${err.message}`);
    incomplete = true;
  }
  completedSteps += 1;

  // Step 2: Root contents & package.json
  try {
    checkAborted();
    updateProgress('contents', 'Scanning repository contents & package manifests...');
    const contentsRes = await fetchWithRetry(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`,
      headers,
      signal,
      fetchFn
    );

    if (contentsRes.ok && Array.isArray(contentsRes.data)) {
      const fileNames = contentsRes.data.map((item: { name: string }) => item.name);
      packageManager = detectPackageManagerFromFiles(fileNames);

      const hasPkgJson = fileNames.includes('package.json');
      if (hasPkgJson) {
        const pkgRes = await fetchWithRetry(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/package.json`,
          headers,
          signal,
          fetchFn
        );

        if (pkgRes.ok && pkgRes.data?.content && pkgRes.data?.encoding === 'base64') {
          try {
            const rawContent = atob(pkgRes.data.content.replace(/\n/g, ''));
            const parsed = parsePackageJson(rawContent);
            if (parsed.framework) framework = parsed.framework;
            if (parsed.testRunner) testRunner = parsed.testRunner;
            parsed.languages.forEach((lang) => languagesSet.add(lang));
          } catch {
            errors.push('Failed to decode/parse package.json.');
            incomplete = true;
          }
        } else {
          errors.push('Failed to fetch package.json content.');
          incomplete = true;
        }
      }
    } else {
      errors.push(`Failed to fetch repo root contents: ${contentsRes.error || contentsRes.status}`);
      incomplete = true;
    }
  } catch (err: any) {
    if (err.name === 'AbortError' || signal?.aborted) {
      return buildPartialProfile({
        owner,
        repo,
        defaultBranch,
        packageManager,
        testRunner,
        framework,
        languages: Array.from(languagesSet),
        conventions,
        customInstructions: customInstructions || 'Scan cancelled by operator.',
        errors: [...errors, 'Scan cancelled during contents fetch.'],
      });
    }
    errors.push(`Contents fetch error: ${err.message}`);
    incomplete = true;
  }
  completedSteps += 1;

  // Step 3: Recent Commits
  try {
    checkAborted();
    updateProgress('commits', 'Analyzing recent commit history...');
    const commitsRes = await fetchWithRetry(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=30`,
      headers,
      signal,
      fetchFn
    );

    if (commitsRes.ok && Array.isArray(commitsRes.data)) {
      const commitConventions = parseCommitMessages(commitsRes.data as GitHubCommitItem[]);
      conventions.push(...commitConventions);
    } else {
      errors.push(`Failed to fetch commits: ${commitsRes.error || commitsRes.status}`);
      incomplete = true;
    }
  } catch (err: any) {
    if (err.name === 'AbortError' || signal?.aborted) {
      return buildPartialProfile({
        owner,
        repo,
        defaultBranch,
        packageManager,
        testRunner,
        framework,
        languages: Array.from(languagesSet),
        conventions,
        customInstructions: customInstructions || 'Scan cancelled by operator.',
        errors: [...errors, 'Scan cancelled during commit analysis.'],
      });
    }
    errors.push(`Commit history fetch error: ${err.message}`);
    incomplete = true;
  }
  completedSteps += 1;

  // Step 4: Lint / Formatting Configs
  try {
    checkAborted();
    updateProgress('configs', 'Checking lint and formatting configurations...');
    // Look for common config files in root
    const configPaths = [
      '.eslintrc.json',
      '.eslintrc.js',
      '.eslintrc.yml',
      'eslint.config.js',
      'eslint.config.mjs',
      '.prettierrc',
      '.prettierrc.json',
      'prettier.config.js',
      'biome.json',
      '.editorconfig',
    ];

    const configFiles: { path: string }[] = [];
    for (const path of configPaths) {
      if (signal?.aborted) break;
      const res = await fetchWithRetry(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
        headers,
        signal,
        fetchFn
      );
      if (res.ok && res.data) {
        configFiles.push({ path });
      }
    }

    const lintConventions = parseLintAndFormatConfigs(configFiles);
    conventions.push(...lintConventions);
  } catch (err: any) {
    if (err.name === 'AbortError' || signal?.aborted) {
      return buildPartialProfile({
        owner,
        repo,
        defaultBranch,
        packageManager,
        testRunner,
        framework,
        languages: Array.from(languagesSet),
        conventions,
        customInstructions: customInstructions || 'Scan cancelled by operator.',
        errors: [...errors, 'Scan cancelled during lint config detection.'],
      });
    }
    errors.push(`Config detection error: ${err.message}`);
    incomplete = true;
  }
  completedSteps += 1;

  if (languagesSet.size === 0) {
    languagesSet.add('TypeScript');
  }

  const languages = Array.from(languagesSet);
  const nowIso = new Date().toISOString();

  const profile: RepoProfile = {
    id: `${owner}/${repo}`,
    repoRef: {
      owner,
      repo,
      defaultBranch,
    },
    stack: {
      packageManager,
      testRunner,
      framework,
      languages,
    },
    conventions,
    customInstructions: customInstructions || undefined,
    notes: incomplete ? `Partial scan completed with errors: ${errors.join('; ')}` : undefined,
    updatedAt: nowIso,
    version: STEERING_SCHEMA_VERSION,
  };

  updateProgress('complete', 'Scan completed successfully.');

  return {
    profile,
    incomplete,
    errors,
  };
}

function buildPartialProfile(data: {
  owner: string;
  repo: string;
  defaultBranch: string;
  packageManager?: string;
  testRunner?: string;
  framework?: string;
  languages: string[];
  conventions: ConventionEntry[];
  customInstructions?: string;
  errors: string[];
}): ScanResult {
  const languages = data.languages.length > 0 ? data.languages : ['TypeScript'];
  const nowIso = new Date().toISOString();

  const profile: RepoProfile = {
    id: `${data.owner}/${data.repo}`,
    repoRef: {
      owner: data.owner,
      repo: data.repo,
      defaultBranch: data.defaultBranch || 'main',
    },
    stack: {
      packageManager: data.packageManager,
      testRunner: data.testRunner,
      framework: data.framework,
      languages,
    },
    conventions: data.conventions,
    customInstructions: data.customInstructions,
    notes: `Scan cancelled or incomplete. Errors: ${data.errors.join('; ')}`,
    updatedAt: nowIso,
    version: STEERING_SCHEMA_VERSION,
  };

  return {
    profile,
    incomplete: true,
    errors: data.errors,
  };
}
