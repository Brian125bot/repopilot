// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  GOAL_EXTRACT_SYSTEM_PROMPT,
  buildExampleTestCommand,
  buildGoalExtractPrompt,
  formatRepoProfileContext,
} from "./extract-prompt";
import { GOAL_CONVENTION_BODY_MAX, GOAL_RAW_TEXT_MAX, GOAL_UNCLEAR_TITLE } from "./types";
import type { RepoProfile } from "@/lib/types/steering";

function profile(overrides: Partial<RepoProfile> = {}): RepoProfile {
  return {
    id: "acme/api-gateway",
    repoRef: { owner: "acme", repo: "api-gateway", defaultBranch: "main" },
    stack: {
      packageManager: "pnpm",
      testRunner: "vitest",
      framework: "Next.js",
      languages: ["TypeScript", "TSX"],
    },
    conventions: [
      {
        id: "c1",
        title: "Typed error codes",
        body: "Every API route returns the shared COR-20 error envelope.",
      },
      {
        id: "c2",
        title: "No lockfile drift",
        body: "Dependency manifests are frozen.",
      },
    ],
    customInstructions: "Prefer additive schema fields over breaking changes.",
    updatedAt: "2026-10-01T09:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("formatRepoProfileContext", () => {
  it("returns an empty string when no profile is supplied", () => {
    expect(formatRepoProfileContext(undefined)).toBe("");
  });

  it("renders the detected stack so criteria can cite real commands and files", () => {
    const context = formatRepoProfileContext(profile());

    expect(context).toContain("acme/api-gateway");
    expect(context).toContain("TypeScript");
    expect(context).toContain("framework Next.js");
    expect(context).toContain("package manager pnpm");
    expect(context).toContain("test runner vitest");
    expect(context).toContain("Typed error codes");
    expect(context).toContain("No lockfile drift");
    expect(context).toContain("Prefer additive schema fields");
  });

  it("omits absent optional fields instead of printing placeholders", () => {
    const context = formatRepoProfileContext(
      profile({ stack: { languages: [] }, conventions: [], customInstructions: undefined })
    );

    expect(context).toContain("acme/api-gateway");
    expect(context).not.toContain("Languages:");
    expect(context).not.toContain("Tooling:");
    expect(context).not.toContain("Conventions detected");
    expect(context).not.toContain("undefined");
  });

  it("truncates long convention bodies and caps the convention count", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      title: `Convention ${i}`,
      body: "x".repeat(GOAL_CONVENTION_BODY_MAX + 500),
    }));
    const context = formatRepoProfileContext(profile({ conventions: many }));

    expect(context).toContain("Convention 7");
    expect(context).not.toContain("Convention 8");
    // One body occurrence is the truncated convention plus the title line.
    const longestRun = Math.max(...context.match(/x+/g)?.map((run) => run.length) ?? [0]);
    expect(longestRun).toBe(GOAL_CONVENTION_BODY_MAX);
  });
});

describe("buildExampleTestCommand", () => {
  it("derives the command form from the detected package manager and runner", () => {
    expect(buildExampleTestCommand(profile())).toBe("pnpm test lib/example.test.ts");
  });

  it("falls back to npm when nothing was detected", () => {
    expect(buildExampleTestCommand(undefined)).toBe("npm test lib/example.test.ts");
    expect(buildExampleTestCommand(profile({ stack: { languages: [] } }))).toBe(
      "npm test lib/example.test.ts"
    );
  });

  it("uses the detected runner verbatim for non-JavaScript runners", () => {
    expect(
      buildExampleTestCommand(profile({ stack: { languages: ["Go"], testRunner: "go test ./..." } }))
    ).toBe("go test ./... ./path/to/file");
  });
});

describe("buildGoalExtractPrompt", () => {
  it("instructs the model to answer UNCLEAR when the input is not actionable", () => {
    expect(GOAL_EXTRACT_SYSTEM_PROMPT).toContain(`"${GOAL_UNCLEAR_TITLE}"`);
    expect(GOAL_EXTRACT_SYSTEM_PROMPT).toContain("ambiguityFlags");
    expect(GOAL_EXTRACT_SYSTEM_PROMPT).toContain("acceptanceCriteria");
  });

  it("grounds the prompt with the repo profile and its real test command", () => {
    const { systemPrompt, userPrompt } = buildGoalExtractPrompt(
      "Add an empty-scan save guard",
      profile()
    );

    expect(systemPrompt).toContain("REPOSITORY PROFILE");
    expect(systemPrompt).toContain("pnpm test lib/example.test.ts");
    expect(userPrompt).toContain("Add an empty-scan save guard");
    expect(userPrompt).toContain("test runner vitest");
    expect(userPrompt).toContain("OPERATOR DESCRIPTION");
  });

  it("tells the model to stay stack-agnostic when no profile is available", () => {
    const { systemPrompt, userPrompt } = buildGoalExtractPrompt("make it better");

    expect(systemPrompt).toBe(GOAL_EXTRACT_SYSTEM_PROMPT);
    expect(systemPrompt).not.toContain("REPOSITORY PROFILE");
    expect(userPrompt).toContain("stack-agnostic");
    expect(userPrompt).toContain("make it better");
  });

  it("bounds the operator text it forwards to the model", () => {
    const huge = "a".repeat(GOAL_RAW_TEXT_MAX + 1000);
    const { userPrompt } = buildGoalExtractPrompt(huge);

    expect(userPrompt.length).toBeLessThan(huge.length);
    expect(userPrompt).toContain('a'.repeat(100));
  });

  it("trims surrounding whitespace from the operator text", () => {
    const { userPrompt } = buildGoalExtractPrompt("   pad the goal   ");
    expect(userPrompt.endsWith("pad the goal")).toBe(true);
  });
});