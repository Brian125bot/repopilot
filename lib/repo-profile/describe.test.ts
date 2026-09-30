// @vitest-environment node
import { describe, it, expect } from "vitest";
import { describeScanOutcome, describeScanError } from "./describe";
import { ScanResult, ScanError } from "./types";

describe("describeScanOutcome", () => {
  it("describes complete outcome", () => {
    const result: ScanResult = {
      profile: {
        id: "foo/bar",
        repoRef: { owner: "foo", repo: "bar" },
        stack: { languages: [] },
        conventions: [],
        updatedAt: "2026-03-30T10:00:00Z",
        version: 1,
      },
      outcome: "complete",
      issues: [],
    };
    expect(describeScanOutcome(result)).toBe("Scan completed successfully.");
  });

  it("describes cancelled outcome", () => {
    const result: ScanResult = {
      profile: {
        id: "foo/bar",
        repoRef: { owner: "foo", repo: "bar" },
        stack: { languages: [] },
        conventions: [],
        updatedAt: "2026-03-30T10:00:00Z",
        version: 1,
        incomplete: true,
      },
      outcome: "cancelled",
      issues: [],
    };
    expect(describeScanOutcome(result)).toBe("Scan was cancelled by user.");
  });

  it("describes partial outcome with issue summaries", () => {
    const result: ScanResult = {
      profile: {
        id: "foo/bar",
        repoRef: { owner: "foo", repo: "bar" },
        stack: { languages: [] },
        conventions: [],
        updatedAt: "2026-03-30T10:00:00Z",
        version: 1,
        incomplete: true,
      },
      outcome: "partial",
      issues: [{ stage: "commits", code: "http_error", status: 500, message: "Server error" }],
    };
    expect(describeScanOutcome(result)).toContain("commits: HTTP 500");
  });
});

describe("describeScanError", () => {
  it("describes ScanError codes accurately", () => {
    expect(describeScanError(new ScanError("unauthorized", "unauthorized"))).toBe(
      "GitHub rejected this token."
    );
    expect(describeScanError(new ScanError("not_found", "not_found"))).toBe(
      "Repository not found, or this token can't access it."
    );
    expect(
      describeScanError(
        new ScanError("rate_limited", "rate_limited", { resetAt: 1774864800000 })
      )
    ).toContain("GitHub API rate limit exceeded");
  });
});
