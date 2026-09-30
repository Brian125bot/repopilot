// @vitest-environment node
import { describe, it, expect } from "vitest";
import { decideSave, isProfileEmpty, EMPTY_REPLACE_MESSAGE } from "./save-policy";
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

describe("isProfileEmpty", () => {
  it("treats an early-cancel profile as empty", () => {
    expect(isProfileEmpty(createEmptyProfile())).toBe(true);
  });

  it("is non-empty when only the default branch was captured", () => {
    const profile = createEmptyProfile();
    profile.repoRef.defaultBranch = "main";
    expect(isProfileEmpty(profile)).toBe(false);
  });

  it("is non-empty when only languages were captured", () => {
    const profile = createEmptyProfile();
    profile.stack.languages = ["TypeScript"];
    expect(isProfileEmpty(profile)).toBe(false);
  });

  it("is non-empty when only a framework was captured", () => {
    const profile = createEmptyProfile();
    profile.stack.framework = "next";
    expect(isProfileEmpty(profile)).toBe(false);
  });

  it("is non-empty when only a package manager was captured", () => {
    const profile = createEmptyProfile();
    profile.stack.packageManager = "npm";
    expect(isProfileEmpty(profile)).toBe(false);
  });

  it("is non-empty when only a test runner was captured", () => {
    const profile = createEmptyProfile();
    profile.stack.testRunner = "vitest";
    expect(isProfileEmpty(profile)).toBe(false);
  });

  it("is non-empty when only a convention was captured", () => {
    const profile = createEmptyProfile();
    profile.conventions = [
      { id: "commits", title: "Commit Guidelines", body: "Conventional Commits.", source: "git commits" },
    ];
    expect(isProfileEmpty(profile)).toBe(false);
  });

  it("is non-empty for a complete scan result", () => {
    const complete: ScanResult = {
      profile: createMockProfile(),
      outcome: "complete",
      issues: [],
    };
    expect(isProfileEmpty(decideSave(null, complete).profile)).toBe(false);
  });
});

describe("empty scan cannot overwrite a saved profile", () => {
  function completeExisting() {
    const existing = createMockProfile({ customInstructions: "keep me" });
    delete existing.incomplete;
    return existing;
  }

  it("skips saving an empty cancelled scan over a complete existing profile", () => {
    const result: ScanResult = {
      profile: createEmptyProfile(),
      outcome: "cancelled",
      issues: [],
    };

    const decision = decideSave(completeExisting(), result);
    expect(decision.action).toBe("skip");
    expect(decision.profile.customInstructions).toBe("keep me");
  });

  it("skips saving an empty timed-out scan over a complete existing profile", () => {
    const result: ScanResult = {
      profile: createEmptyProfile(),
      outcome: "timed_out",
      issues: [],
    };

    expect(decideSave(completeExisting(), result).action).toBe("skip");
  });

  it("skips saving an empty partial scan over a complete existing profile", () => {
    const result: ScanResult = {
      profile: createEmptyProfile(),
      outcome: "partial",
      issues: [{ stage: "metadata", code: "network", message: "Failed to fetch repo metadata" }],
    };

    expect(decideSave(completeExisting(), result).action).toBe("skip");
  });

  it("still skips a non-empty but incomplete scan over a complete existing profile", () => {
    const result: ScanResult = {
      profile: createEmptyProfile(),
      outcome: "cancelled",
      issues: [],
    };
    result.profile.repoRef.defaultBranch = "main";

    const decision = decideSave(completeExisting(), result);
    expect(isProfileEmpty(decision.profile)).toBe(false);
    expect(decision.action).toBe("skip");
  });

  it("exposes the exact operator-facing rejection message", () => {
    expect(EMPTY_REPLACE_MESSAGE).toBe(
      "Cannot replace existing profile with an empty scan result."
    );
  });
});
