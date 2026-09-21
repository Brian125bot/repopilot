// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { scanRepository } from "./scan";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("scanRepository", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("performs 4-stage scan successfully and detects vitest testRunner", async () => {
    // Stage 1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ default_branch: "main", description: "Test desc" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ TypeScript: 1000 }),
    });

    // Stage 2
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

    // Stage 3
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { commit: { message: "feat(ui): add button" } },
        { commit: { message: "fix: bug" } },
      ],
    });

    // Stage 4
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tree: [{ path: ".eslintrc.json" }, { path: "biome.json" }],
      }),
    });

    const profile = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: "fake" }
    );

    expect(profile.incomplete).toBeUndefined();
    expect(profile.repoRef.owner).toBe("foo");
    expect(profile.repoRef.defaultBranch).toBe("main");
    expect(profile.notes).toBe("Test desc");
    expect(profile.stack.languages).toEqual(["TypeScript"]);
    expect(profile.stack.framework).toBe("react");
    expect(profile.stack.testRunner).toBe("vitest");

    expect(profile.conventions).toContainEqual(
      expect.objectContaining({ id: "manifest" })
    );
    expect(profile.conventions).toContainEqual(
      expect.objectContaining({ id: "commits" })
    );
    expect(profile.conventions).toContainEqual(
      expect.objectContaining({ id: "lint-format" })
    );
  });

  it("decodes package.json base64 containing newlines (GitHub wrapped)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ default_branch: "main", description: "Test desc" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ JavaScript: 500 }),
    });

    const rawJson = JSON.stringify({ name: "wrapped-app", scripts: { test: "vitest" } });
    const b64 = Buffer.from(rawJson).toString("base64");
    // Wrap base64 with newlines every 10 chars to simulate GitHub wrapping
    const wrappedB64 = b64.match(/.{1,10}/g)?.join("\n") || b64;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: wrappedB64,
      }),
    });

    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const profile = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: "fake" }
    );

    expect(profile.conventions).toContainEqual(
      expect.objectContaining({
        id: "manifest",
        body: expect.stringContaining("Project Name: wrapped-app"),
      })
    );
  });

  it("handles partial failures cleanly (fail-soft)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const profile = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: "fake" }
    );

    expect(profile.incomplete).toBeUndefined();
    expect(profile.repoRef.owner).toBe("foo");
    expect(profile.conventions).toHaveLength(0);
  });

  it("aborts mid-scan and returns incomplete profile without race condition", async () => {
    const ac = new AbortController();

    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (opts.signal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      if (url.includes("/languages")) {
        ac.abort();
        throw new DOMException("The operation was aborted", "AbortError");
      }
      return {
        ok: true,
        json: async () => ({ default_branch: "main", description: "Test desc" }),
      };
    });

    const profile = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: "fake", signal: ac.signal }
    );

    expect(profile.incomplete).toBe(true);
    expect(profile.repoRef.defaultBranch).toBe("main");
  });

  it("handles deadlineMs expiration returning incomplete profile", async () => {
    mockFetch.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        ok: true,
        json: async () => ({ default_branch: "main", description: "Test desc" }),
      };
    });

    const profile = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: "fake", deadlineMs: 20 }
    );

    expect(profile.incomplete).toBe(true);
  });

  it("handles rate-limit (403) with exponential backoff", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers({
        "x-ratelimit-reset": ((Date.now() + 500) / 1000).toString(),
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ default_branch: "main", description: "Test desc" }),
    });
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const profile = await scanRepository(
      { owner: "foo", repo: "bar" },
      { githubPat: "fake" }
    );

    expect(mockFetch).toHaveBeenCalledTimes(6);
    expect(profile.repoRef.defaultBranch).toBe("main");
  });
});
