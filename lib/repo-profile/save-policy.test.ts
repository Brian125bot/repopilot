// @vitest-environment node
import { describe, it, expect } from "vitest";
import { decideSave } from "./save-policy";
import { ScanResult } from "./types";
import { RepoProfile } from "@/lib/types/steering";

function createMockProfile(overrides?: Partial<RepoProfile & { incomplete?: boolean }>): RepoProfile & { incomplete?: boolean } {
  return {
    id: "foo/bar",
    repoRef: { owner: "foo", repo: "bar", defaultBranch: "main" },
    stack: { languages: ["TypeScript"] },
    conventions: [{ id: "manifest", title: "Manifest", body: "Name: bar", source: "package.json" }],
    updatedAt: "2026-03-30T10:00:00Z",
    version: 1,
    ...overrides,
  };
}

function createEmptyProfile(): RepoProfile & { incomplete?: boolean } {
  return {
    id: "foo/bar",
    repoRef: { owner: "foo", repo: "bar" },
    stack: { languages: [] },
    conventions: [],
    updatedAt: "2026-03-30T10:00:00Z",
    version: 1,
    incomplete: true,
  };
}

describe("savePolicy (decideSave)", () => {
  it("saves complete scan result replacing any existing profile", () => {
    const existing = createMockProfile({ incomplete: true, customInstructions: "existing instructions" });
    const result: ScanResult = {
      profile: createMockProfile(),
      outcome: "complete",
      issues: [],
    };

    const decision = decideSave(existing, result);
    expect(decision.action).toBe("save");
    expect(decision.profile.incomplete).toBeUndefined();
    expect(decision.profile.customInstructions).toBe("existing instructions");
  });

  it("saves incomplete result when no existing profile exists", () => {
    const result: ScanResult = {
      profile: createMockProfile({ incomplete: true }),
      outcome: "partial",
      issues: [{ stage: "commits", code: "http_error", status: 500, message: "Server error" }],
    };

    const decision = decideSave(null, result);
    expect(decision.action).toBe("save");
    expect(decision.profile.incomplete).toBe(true);
  });

  it("skips incomplete result when existing profile is complete", () => {
    const existing = createMockProfile({ customInstructions: "keep instructions" });
    delete existing.incomplete;

    const result: ScanResult = {
      profile: createMockProfile({ incomplete: true }),
      outcome: "partial",
      issues: [{ stage: "commits", code: "http_error", status: 500, message: "Server error" }],
    };

    const decision = decideSave(existing, result);
    expect(decision.action).toBe("skip");
    expect(decision.profile.customInstructions).toBe("keep instructions");
  });

  it("saves incomplete result when existing profile is also incomplete", () => {
    const existing = createMockProfile({ incomplete: true });
    const result: ScanResult = {
      profile: createMockProfile({ incomplete: true }),
      outcome: "partial",
      issues: [{ stage: "commits", code: "http_error", status: 500, message: "Server error" }],
    };

    const decision = decideSave(existing, result);
    expect(decision.action).toBe("save");
    expect(decision.profile.incomplete).toBe(true);
  });

  it("skips empty partial scans (e.g. cancelled during stage 1 gate)", () => {
    const result: ScanResult = {
      profile: createEmptyProfile(),
      outcome: "cancelled",
      issues: [],
    };

    const decision = decideSave(null, result);
    expect(decision.action).toBe("skip");
  });

  it("preserves case-sensitive id of existing profile when matching case-insensitively", () => {
    const existing = createMockProfile({ id: "Foo/Bar" });
    delete existing.incomplete;

    const result: ScanResult = {
      profile: createMockProfile({ id: "foo/bar" }),
      outcome: "complete",
      issues: [],
    };

    const decision = decideSave(existing, result);
    expect(decision.action).toBe("save");
    expect(decision.profile.id).toBe("Foo/Bar");
  });
});
