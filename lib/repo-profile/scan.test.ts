// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scanRepository } from "./scan";
import { ScanError } from "./types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("scanRepository", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("performs 4-stage scan successfully and detects vitest testRunner", async () => {
    // Stage 1: Metadata & Languages
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ default_branch: "main", description: "Test desc", owner: { login: "foo" }, name: "bar" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ TypeScript: 1000 }),
    });

    // Stage 2: Manifest
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: Buffer.from(
          JSON.stringify({
            name: "test-app",
            devDependencies: { vitest: "^1.0.0" },
            dependencies: { react: "18" },
            scripts: { build: "tsc" },
          })
        ).toString("base64"),
      }),
    });

    // Stage 3: Commits
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { commit: { message: "feat(ui): add button" } },
        { commit: { message: "fix: bug" } },
      ],
    });

    // Stage 4: Config
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tree: [{ path: ".eslintrc.json" }, { path: "biome.json" }],
      }),
    });

    const result = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: "secret_pat_123" }
    );

    expect(result.outcome).toBe("complete");
    expect(result.profile.incomplete).toBeUndefined();
    expect(result.profile.repoRef.owner).toBe("foo");
    expect(result.profile.repoRef.defaultBranch).toBe("main");
    expect(result.profile.notes).toBe("Test desc");
    expect(result.profile.stack.languages).toEqual(["TypeScript"]);
    expect(result.profile.stack.framework).toBe("react");
    expect(result.profile.stack.testRunner).toBe("vitest");

    expect(result.profile.conventions).toContainEqual(
      expect.objectContaining({ id: "manifest" })
    );
    expect(result.profile.conventions).toContainEqual(
      expect.objectContaining({ id: "commits" })
    );
    expect(result.profile.conventions).toContainEqual(
      expect.objectContaining({ id: "lint-format" })
    );
  });

  it("throws ScanError on stage 1 gate errors (401, 404, network)", async () => {
    // 401 Unauthorized
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(
      scanRepository({ owner: "foo", repo: "bar" }, { githubPat: "fake" })
    ).rejects.toThrowError(
      expect.objectContaining({ name: "ScanError", code: "unauthorized", status: 401 })
    );

    // 404 Not Found
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(
      scanRepository({ owner: "foo", repo: "bar" }, { githubPat: "fake" })
    ).rejects.toThrowError(
      expect.objectContaining({ name: "ScanError", code: "not_found", status: 404 })
    );

    // Network error
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(
      scanRepository({ owner: "foo", repo: "bar" }, { githubPat: "fake" })
    ).rejects.toThrowError(
      expect.objectContaining({ name: "ScanError", code: "network" })
    );
  });

  it("handles benign stage responses and non-fatal stage errors (manifest 404 vs commits 500)", async () => {
    // Stage 1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ default_branch: "main", owner: { login: "foo" }, name: "bar" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ JavaScript: 500 }),
    });

    // Stage 2: Manifest 404 (benign, no issue)
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    // Stage 3: Commits 500 (non-fatal, pushes ScanIssue)
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    // Stage 4: Config
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tree: [{ path: ".editorconfig" }] }),
    });

    const result = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: "fake" }
    );

    expect(result.outcome).toBe("partial");
    expect(result.profile.incomplete).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toEqual(
      expect.objectContaining({ stage: "commits", code: "http_error", status: 500 })
    );
    expect(result.profile.stack.languages).toEqual(["JavaScript"]);
    expect(result.profile.conventions).toContainEqual(
      expect.objectContaining({ id: "lint-format" })
    );
  });

  it("continues to later stages when languages fetch throws", async () => {
    // Stage 1: Repo metadata OK
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ default_branch: "main", owner: { login: "foo" }, name: "bar" }),
    });

    // Stage 1b: Languages throws network error
    mockFetch.mockRejectedValueOnce(new TypeError("Network error"));

    // Stage 2: Manifest
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: Buffer.from(JSON.stringify({ name: "my-pkg" })).toString("base64"),
      }),
    });

    // Stage 3: Commits
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    // Stage 4: Config
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tree: [] }),
    });

    const result = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: "fake" }
    );

    expect(result.outcome).toBe("partial");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ stage: "metadata", code: "network" })
    );
    expect(result.profile.conventions).toContainEqual(
      expect.objectContaining({ id: "manifest" })
    );
  });

  it("times out near deadline for hung fetches (< 500 ms for deadlineMs: 30)", async () => {
    const start = Date.now();

    // Hung fetch
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const result = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: "fake", deadlineMs: 30 }
    );

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(500);
    expect(result.outcome).toBe("timed_out");
    expect(result.profile.incomplete).toBe(true);
  });

  it("returns cancelled in < 1s when user aborts during backoff sleep", async () => {
    const ac = new AbortController();

    // Stage 1 metadata OK
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ default_branch: "main", owner: { login: "foo" }, name: "bar" }),
    });

    // Stage 1b languages returns 429 with retry-after: 2
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/languages")) {
        // Abort while backoff sleep is running
        setTimeout(() => ac.abort(), 50);
        return {
          status: 429,
          headers: new Headers({ "retry-after": "2" }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const start = Date.now();
    const result = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: "fake", signal: ac.signal }
    );

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    expect(result.outcome).toBe("cancelled");
    expect(result.profile.incomplete).toBe(true);
  });

  it("handles rate limits: bare 403 not retried, 429 retried once, reset > 5s surfaces rate_limited", async () => {
    // 1. Bare 403 is forbidden, not retried
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers() });
    await expect(
      scanRepository({ owner: "foo", repo: "bar" }, { githubPat: "fake" })
    ).rejects.toThrowError(
      expect.objectContaining({ name: "ScanError", code: "forbidden" })
    );

    mockFetch.mockReset();

    // 2. 429 + retry-after: 1 -> retried exactly once
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ "retry-after": "1" }),
    });
    // Successful retry for Stage 1 metadata
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ default_branch: "main", owner: { login: "foo" }, name: "bar" }),
    });
    // Stage 1b languages
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ TypeScript: 100 }),
    });
    // Stage 2 manifest
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: Buffer.from(JSON.stringify({ name: "test" })).toString("base64") }),
    });
    // Stage 3 commits
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    // Stage 4 tree
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tree: [] }),
    });

    const retriedResult = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: "fake" }
    );
    expect(retriedResult.outcome).toBe("complete");

    mockFetch.mockReset();

    // 3. Reset > 5s -> no retry, rate_limited with resetAt
    const futureReset = Math.floor((Date.now() + 10000) / 1000);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers({
        "x-ratelimit-reset": futureReset.toString(),
        "x-ratelimit-remaining": "0",
      }),
    });

    await expect(
      scanRepository({ owner: "foo", repo: "bar" }, { githubPat: "fake" })
    ).rejects.toThrowError(
      expect.objectContaining({
        name: "ScanError",
        code: "rate_limited",
        resetAt: futureReset * 1000,
      })
    );
  });

  it("never exposes PAT in JSON.stringify(result), errors, or console", async () => {
    const pat = "secret_ghp_999888777666";
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ default_branch: "main", description: "pat check", owner: { login: "foo" }, name: "bar" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ TypeScript: 100 }),
    });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 }); // Manifest error
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const result = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: pat }
    );

    const jsonString = JSON.stringify(result);
    expect(jsonString).not.toContain(pat);

    for (const call of consoleSpy.mock.calls) {
      for (const arg of call) {
        expect(String(arg)).not.toContain(pat);
      }
    }
  });

  it("validates repository refs and rejects invalid inputs with zero fetches", async () => {
    const invalidRefs = ["..", "a/b?x", "%2F", ""];

    for (const invalid of invalidRefs) {
      mockFetch.mockReset();
      const [owner, repo] = invalid.split("/");

      await expect(
        scanRepository({ owner: owner || "", repo: repo || "" }, { githubPat: "fake" })
      ).rejects.toThrowError(
        expect.objectContaining({ name: "ScanError", code: "invalid_ref" })
      );

      expect(mockFetch).not.toHaveBeenCalled();
    }
  });

  it("decodes UTF-8 package.json and wrapped base64, and handles non-array commits/tree cleanly", async () => {
    // Stage 1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ default_branch: "main", owner: { login: "foo" }, name: "bar" }),
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    // Stage 2: UTF-8 with special characters wrapped in base64
    const unicodeJson = JSON.stringify({ name: "🚀-app", scripts: { test: "vitest" } });
    const b64 = Buffer.from(unicodeJson, "utf-8").toString("base64");
    const wrappedB64 = b64.match(/.{1,10}/g)?.join("\n") || b64;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: wrappedB64 }),
    });

    // Stage 3: Non-array commits response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: "Not an array" }),
    });

    // Stage 4: Non-array tree response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tree: "invalid" }),
    });

    const result = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: "fake" }
    );

    expect(result.outcome).toBe("partial");
    expect(result.profile.conventions).toContainEqual(
      expect.objectContaining({
        id: "manifest",
        body: expect.stringContaining("Project Name: 🚀-app"),
      })
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({ stage: "commits", code: "parse" })
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ stage: "config", code: "parse" })
    );
  });
});
