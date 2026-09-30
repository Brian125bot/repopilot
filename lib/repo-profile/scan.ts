import { RepoProfile } from "@/lib/types/steering";
import { parsePackageJson, parseCommits, detectLintFormat } from "./parsers";
import {
  ScanResult,
  ScanIssue,
  ScanStage,
  ScanError,
  ScanErrorCode,
} from "./types";
import { validateAndParseRef } from "./ref";

export interface ScanOptions {
  githubPat: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  onProgress?: (stage: ScanStage, message: string) => void;
}

/**
 * GitHub's git-trees endpoint takes a ref name, not a single path segment, so a
 * branch like `feature/COR-54` must reach the API with its slashes intact.
 * `encodeURIComponent` would turn that into `feature%2FCOR-54`, which the endpoint
 * does not resolve as a ref. Encode each segment and rejoin with "/".
 */
export function encodeRefPath(ref: string): string {
  return ref
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodeBase64Content(raw: string): string {
  const cleaned = raw.replace(/\s+/g, "");
  if (typeof atob === "function" && typeof TextDecoder !== "undefined") {
    const binaryStr = atob(cleaned);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(cleaned, "base64").toString("utf8");
  }
  throw new Error("No base64 decoder available");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

interface FetchResult {
  response?: Response;
  error?: unknown;
  isRateLimited?: boolean;
  rateLimitError?: ScanError;
}

async function fetchWithBackoff(
  url: string,
  options: RequestInit,
  internalSignal: AbortSignal,
  getRemainingMs: () => number
): Promise<FetchResult> {
  if (internalSignal.aborted) {
    return { error: new DOMException("The operation was aborted", "AbortError") };
  }

  const executeFetch = async (fetchUrl: string, fetchOpts: RequestInit): Promise<FetchResult> => {
    const fetchPromise = fetch(fetchUrl, { ...fetchOpts, signal: internalSignal })
      .then((res) => ({ response: res }))
      .catch((err) => ({ error: err }));

    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<FetchResult>((resolve) => {
      if (internalSignal.aborted) {
        resolve({ error: new DOMException("The operation was aborted", "AbortError") });
        return;
      }
      onAbort = () => {
        resolve({ error: new DOMException("The operation was aborted", "AbortError") });
      };
      internalSignal.addEventListener("abort", onAbort, { once: true });
    });

    try {
      return await Promise.race([fetchPromise, abortPromise]);
    } finally {
      // The listener only exists to win the race. When the fetch settles first the
      // abort promise never resolves, so without this the listener would stay
      // attached to the long-lived internal controller for the rest of the scan and
      // accumulate one closure per request.
      if (onAbort) {
        internalSignal.removeEventListener("abort", onAbort);
      }
    }
  };

  const initial = await executeFetch(url, options);
  if (initial.error || !initial.response) {
    return initial;
  }

  const response = initial.response;

  // Rate-limit checking (429 or 403 with rate-limit headers)
  if (response.status === 429 || response.status === 403) {
    const retryAfter = response.headers.get("retry-after");
    const resetHeader = response.headers.get("x-ratelimit-reset");
    const remainingHeader = response.headers.get("x-ratelimit-remaining");

    const hasRateLimitHeaders =
      response.status === 429 ||
      Boolean(retryAfter) ||
      Boolean(resetHeader) ||
      remainingHeader === "0";

    if (!hasRateLimitHeaders && response.status === 403) {
      // Bare 403 -> forbidden, no retry
      return { response };
    }

    // Calculate resetAt
    let resetAt: number | undefined;
    let waitTimeMs = 1000;

    if (resetHeader) {
      const parsedReset = parseInt(resetHeader, 10);
      if (!isNaN(parsedReset)) {
        resetAt = parsedReset * 1000;
        waitTimeMs = Math.max(1000, resetAt - Date.now() + 100);
      }
    } else if (retryAfter) {
      const parsedAfter = parseInt(retryAfter, 10);
      if (!isNaN(parsedAfter)) {
        waitTimeMs = Math.max(1000, parsedAfter * 1000);
        resetAt = Date.now() + waitTimeMs;
      }
    } else {
      waitTimeMs = 1000;
    }

    const remainingBudget = getRemainingMs();

    // If waitTime > 5s or > remaining budget, do NOT retry; surface rate_limited with resetAt
    if (waitTimeMs > 5000 || waitTimeMs > remainingBudget) {
      return {
        response,
        isRateLimited: true,
        rateLimitError: new ScanError("GitHub API rate limit exceeded", "rate_limited", {
          status: response.status,
          resetAt,
        }),
      };
    }

    // Wait abortably and retry once
    await sleep(waitTimeMs, internalSignal);

    if (internalSignal.aborted) {
      return { error: new DOMException("The operation was aborted", "AbortError") };
    }

    const retryResult = await executeFetch(url, options);
    if (retryResult.error || !retryResult.response) {
      return retryResult;
    }

    const retryResponse = retryResult.response;
    if (retryResponse.status === 429 || retryResponse.status === 403) {
      const secondReset = retryResponse.headers.get("x-ratelimit-reset");
      let secondResetAt = resetAt;
      if (secondReset) {
        const p = parseInt(secondReset, 10);
        if (!isNaN(p)) secondResetAt = p * 1000;
      }
      return {
        response: retryResponse,
        isRateLimited: true,
        rateLimitError: new ScanError("GitHub API rate limit exceeded", "rate_limited", {
          status: retryResponse.status,
          resetAt: secondResetAt,
        }),
      };
    }

    return { response: retryResponse };
  }

  return { response };
}

function classifyHttpStatus(status: number): ScanErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return "http_error";
}

export async function scanRepository(
  target: { owner: string; repo: string },
  options: ScanOptions
): Promise<ScanResult> {
  const validated = validateAndParseRef(target);

  const { githubPat, signal, deadlineMs = 15000, onProgress } = options;
  const startTime = Date.now();
  const getRemainingMs = () => deadlineMs - (Date.now() - startTime);

  const ctrl = new AbortController();
  let userCancelled = false;
  let timedOut = false;

  if (signal?.aborted) {
    userCancelled = true;
  } else if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        userCancelled = true;
        ctrl.abort();
      },
      { once: true }
    );
  }

  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, deadlineMs);

  const headers = {
    Authorization: `Bearer ${githubPat}`,
    Accept: "application/vnd.github.v3+json",
  };

  const profile: RepoProfile & { incomplete?: boolean } = {
    id: validated.canonicalId,
    repoRef: {
      owner: validated.owner,
      repo: validated.repo,
    },
    stack: {
      languages: [],
    },
    conventions: [],
    updatedAt: new Date().toISOString(),
    version: 1,
    incomplete: true,
  };

  const issues: ScanIssue[] = [];

  try {
    if (ctrl.signal.aborted || userCancelled || timedOut) {
      return {
        profile,
        outcome: userCancelled ? "cancelled" : "timed_out",
        issues,
      };
    }

    // ==========================================
    // Stage 1: Metadata Gate
    // ==========================================
    onProgress?.("metadata", "Fetching repository metadata...");

    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(validated.owner)}/${encodeURIComponent(validated.repo)}`;
    const repoRes = await fetchWithBackoff(repoUrl, { headers }, ctrl.signal, getRemainingMs);

    if (ctrl.signal.aborted || userCancelled || timedOut) {
      return {
        profile,
        outcome: userCancelled ? "cancelled" : "timed_out",
        issues,
      };
    }

    if (repoRes.isRateLimited && repoRes.rateLimitError) {
      throw repoRes.rateLimitError;
    }

    if (repoRes.error) {
      throw new ScanError("Network error while accessing repository", "network");
    }

    const repoResponse = repoRes.response;
    if (!repoResponse || !repoResponse.ok) {
      const status = repoResponse?.status;
      const code = status ? classifyHttpStatus(status) : "network";
      throw new ScanError(`Failed to fetch repo metadata (status ${status ?? "unknown"})`, code, { status });
    }

    const repoData = await repoResponse.json();
    if (repoData && typeof repoData === "object") {
      if (repoData.owner?.login && repoData.name) {
        profile.repoRef.owner = repoData.owner.login;
        profile.repoRef.repo = repoData.name;
        profile.id = `${repoData.owner.login}/${repoData.name}`.toLowerCase();
      }
      if (repoData.default_branch) {
        profile.repoRef.defaultBranch = repoData.default_branch;
      }
      if (repoData.description) {
        profile.notes = repoData.description;
      }
    }

    // Stage 1b: Languages (Later stage, fail-soft)
    if (!ctrl.signal.aborted) {
      const langsUrl = `https://api.github.com/repos/${encodeURIComponent(validated.owner)}/${encodeURIComponent(validated.repo)}/languages`;
      const langsRes = await fetchWithBackoff(langsUrl, { headers }, ctrl.signal, getRemainingMs);

      if (!ctrl.signal.aborted) {
        if (langsRes.isRateLimited && langsRes.rateLimitError) {
          issues.push({ stage: "metadata", code: "rate_limited", status: langsRes.rateLimitError.status, message: langsRes.rateLimitError.message });
        } else if (langsRes.error) {
          issues.push({ stage: "metadata", code: "network", message: "Failed to fetch languages" });
        } else if (langsRes.response && !langsRes.response.ok) {
          issues.push({
            stage: "metadata",
            code: classifyHttpStatus(langsRes.response.status),
            status: langsRes.response.status,
            message: `Languages fetch returned status ${langsRes.response.status}`,
          });
        } else if (langsRes.response?.ok) {
          try {
            const langsData = await langsRes.response.json();
            if (langsData && typeof langsData === "object" && !Array.isArray(langsData)) {
              profile.stack.languages = Object.keys(langsData);
            } else {
              issues.push({ stage: "metadata", code: "parse", message: "Languages data is not an object" });
            }
          } catch {
            issues.push({ stage: "metadata", code: "parse", message: "Failed to parse languages JSON" });
          }
        }
      }
    }

    // ==========================================
    // Stage 2: Manifest
    // ==========================================
    if (!ctrl.signal.aborted) {
      onProgress?.("manifest", "Inspecting package.json...");
      const pkgUrl = `https://api.github.com/repos/${encodeURIComponent(validated.owner)}/${encodeURIComponent(validated.repo)}/contents/package.json`;
      const pkgRes = await fetchWithBackoff(pkgUrl, { headers }, ctrl.signal, getRemainingMs);

      if (!ctrl.signal.aborted) {
        if (pkgRes.isRateLimited && pkgRes.rateLimitError) {
          issues.push({ stage: "manifest", code: "rate_limited", status: pkgRes.rateLimitError.status, message: pkgRes.rateLimitError.message });
        } else if (pkgRes.error) {
          issues.push({ stage: "manifest", code: "network", message: "Failed to fetch package.json" });
        } else if (pkgRes.response && !pkgRes.response.ok) {
          // 404 is benign for manifest (no package.json)
          if (pkgRes.response.status !== 404) {
            issues.push({
              stage: "manifest",
              code: classifyHttpStatus(pkgRes.response.status),
              status: pkgRes.response.status,
              message: `package.json fetch returned status ${pkgRes.response.status}`,
            });
          }
        } else if (pkgRes.response?.ok) {
          try {
            const pkgData = await pkgRes.response.json();
            if (pkgData?.content) {
              const content = decodeBase64Content(pkgData.content);
              const manifest = parsePackageJson(content);

              if (manifest.packageManager) profile.stack.packageManager = manifest.packageManager;
              if (manifest.frameworks.length > 0) profile.stack.framework = manifest.frameworks.join(", ");
              if (manifest.testRunner) profile.stack.testRunner = manifest.testRunner;

              const conventionBody = [
                manifest.name ? `Project Name: ${manifest.name}` : null,
                manifest.scripts.length > 0 ? `Available scripts: ${manifest.scripts.join(", ")}` : null,
              ]
                .filter(Boolean)
                .join("\n");

              if (conventionBody) {
                profile.conventions.push({
                  id: "manifest",
                  title: "Project Manifest (package.json)",
                  body: conventionBody,
                  source: "package.json",
                });
              }
            }
          } catch {
            issues.push({ stage: "manifest", code: "parse", message: "Failed to parse package.json" });
          }
        }
      }
    }

    // ==========================================
    // Stage 3: Commits
    // ==========================================
    if (!ctrl.signal.aborted) {
      onProgress?.("commits", "Analyzing recent commits...");
      const commitsUrl = `https://api.github.com/repos/${encodeURIComponent(validated.owner)}/${encodeURIComponent(validated.repo)}/commits?per_page=30`;
      const commitsRes = await fetchWithBackoff(commitsUrl, { headers }, ctrl.signal, getRemainingMs);

      if (!ctrl.signal.aborted) {
        if (commitsRes.isRateLimited && commitsRes.rateLimitError) {
          issues.push({ stage: "commits", code: "rate_limited", status: commitsRes.rateLimitError.status, message: commitsRes.rateLimitError.message });
        } else if (commitsRes.error) {
          issues.push({ stage: "commits", code: "network", message: "Failed to fetch commits" });
        } else if (commitsRes.response && !commitsRes.response.ok) {
          // 409 is benign (empty repo with no commits)
          if (commitsRes.response.status !== 409) {
            issues.push({
              stage: "commits",
              code: classifyHttpStatus(commitsRes.response.status),
              status: commitsRes.response.status,
              message: `Commits fetch returned status ${commitsRes.response.status}`,
            });
          }
        } else if (commitsRes.response?.ok) {
          try {
            const commitsData = await commitsRes.response.json();
            if (Array.isArray(commitsData)) {
              const messages: string[] = [];
              for (const c of commitsData) {
                if (c && typeof c === "object" && c.commit && typeof c.commit.message === "string") {
                  messages.push(c.commit.message);
                }
              }
              const parsedCommits = parseCommits(messages);

              if (parsedCommits.conventional || parsedCommits.ticketPrefix) {
                let body = "";
                if (parsedCommits.conventional) body += "Repository follows Conventional Commits.\n";
                if (parsedCommits.ticketPrefix)
                  body += `Repository uses ticket prefixes (e.g. ${parsedCommits.samplePrefixes.join(", ")}).`;

                profile.conventions.push({
                  id: "commits",
                  title: "Commit Guidelines",
                  body: body.trim(),
                  source: "git commits",
                });
              }
            } else {
              issues.push({ stage: "commits", code: "parse", message: "Commits response is not an array" });
            }
          } catch {
            issues.push({ stage: "commits", code: "parse", message: "Failed to parse commits JSON" });
          }
        }
      }
    }

    // ==========================================
    // Stage 4: Configuration
    // ==========================================
    if (!ctrl.signal.aborted) {
      onProgress?.("config", "Detecting lint and formatting configuration...");
      const targetBranch = profile.repoRef.defaultBranch || "main";
      const treeUrl = `https://api.github.com/repos/${encodeURIComponent(validated.owner)}/${encodeURIComponent(validated.repo)}/git/trees/${encodeRefPath(targetBranch)}?recursive=0`;
      const treeRes = await fetchWithBackoff(treeUrl, { headers }, ctrl.signal, getRemainingMs);

      if (!ctrl.signal.aborted) {
        if (treeRes.isRateLimited && treeRes.rateLimitError) {
          issues.push({ stage: "config", code: "rate_limited", status: treeRes.rateLimitError.status, message: treeRes.rateLimitError.message });
        } else if (treeRes.error) {
          issues.push({ stage: "config", code: "network", message: "Failed to fetch git tree" });
        } else if (treeRes.response && !treeRes.response.ok) {
          // 404 or 409 is benign
          if (treeRes.response.status !== 404 && treeRes.response.status !== 409) {
            issues.push({
              stage: "config",
              code: classifyHttpStatus(treeRes.response.status),
              status: treeRes.response.status,
              message: `Git tree fetch returned status ${treeRes.response.status}`,
            });
          }
        } else if (treeRes.response?.ok) {
          try {
            const treeData = await treeRes.response.json();
            if (treeData && Array.isArray(treeData.tree)) {
              const files: string[] = [];
              for (const item of treeData.tree) {
                if (item && typeof item.path === "string") {
                  files.push(item.path);
                }
              }

              const detected = detectLintFormat(files);
              let configBody = "";
              if (detected.eslint) configBody += "Uses ESLint.\n";
              if (detected.prettier) configBody += "Uses Prettier.\n";
              if (detected.biome) configBody += "Uses Biome.\n";
              if (detected.editorconfig) configBody += "Uses EditorConfig.\n";

              if (configBody) {
                profile.conventions.push({
                  id: "lint-format",
                  title: "Lint & Format Tooling",
                  body: configBody.trim(),
                  source: "Root configs",
                });
              }
            } else {
              issues.push({ stage: "config", code: "parse", message: "Git tree response missing tree array" });
            }
          } catch {
            issues.push({ stage: "config", code: "parse", message: "Failed to parse git tree JSON" });
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  // Set completion timestamp
  profile.updatedAt = new Date().toISOString();

  // Determine outcome with abort precedence
  let outcome: ScanResult["outcome"];
  if (userCancelled) {
    outcome = "cancelled";
  } else if (timedOut) {
    outcome = "timed_out";
  } else if (issues.length > 0) {
    outcome = "partial";
  } else {
    outcome = "complete";
  }

  if (outcome === "complete") {
    delete profile.incomplete;
  } else {
    profile.incomplete = true;
  }

  return {
    profile,
    outcome,
    issues,
  };
}
