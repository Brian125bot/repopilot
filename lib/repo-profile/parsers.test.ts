// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseCommits, extractTicketKey } from "./parsers/commit";
import { detectLintFormat } from "./parsers/lint-format";

describe("commit parser", () => {
  it("ignores merge commits and evaluates first line only", () => {
    const messages = [
      "Merge branch 'main' into feature/cor-54\nDetailed description of merge",
      "Merge pull request #23 from owner/branch\nMore details",
      "feat(scope): implement feature (COR-54)\nDetailed body line that should be ignored",
    ];

    const result = parseCommits(messages);
    expect(result.conventional).toBe(true);
    expect(result.ticketPrefix).toBe(true);
    expect(result.samplePrefixes).toEqual(["COR"]);
  });

  it("extracts ticket project keys from various commit formats", () => {
    const messages = [
      "COR-54: initial commit",
      "[COR-55] add tests",
      "feat(COR-56): inline ticket in conventional type",
      "fix: resolved bug (COR-57)",
    ];

    const result = parseCommits(messages);
    expect(result.ticketPrefix).toBe(true);
    expect(result.samplePrefixes).toEqual(["COR"]);
  });

  it("does not treat standards names as ticket keys", () => {
    const standards = [
      "fix: hash the payload with SHA-256",
      "chore: tighten UTF-8 handling",
      "docs: align ISO-8601 timestamps",
      "refactor: follow RFC-2119 wording",
      "test: cover the HMAC-512 path",
      "perf: trim the UUID-1 allocation",
    ];

    for (const subject of standards) {
      expect(extractTicketKey(subject)).toBeNull();
    }

    const result = parseCommits(standards);
    expect(result.ticketPrefix).toBe(false);
    expect(result.samplePrefixes).toEqual([]);
  });

  it("refuses standards prefixes even in an anchored slot", () => {
    expect(extractTicketKey("UTF-8: migration notes")).toBeNull();
    expect(extractTicketKey("[SHA-256] digest helper")).toBeNull();
    expect(extractTicketKey("chore(ISO-8601): tighten parsing")).toBeNull();
  });

  it("still recognises tickets in every anchored slot", () => {
    expect(extractTicketKey("COR-54: harden the scanner")).toBe("COR");
    expect(extractTicketKey("[COR-54] harden the scanner")).toBe("COR");
    expect(extractTicketKey("feat(COR-54): harden the scanner")).toBe("COR");
    expect(extractTicketKey("feat(scope, COR-54): harden the scanner")).toBe("COR");
    expect(extractTicketKey("fix: resolved bug (COR-54)")).toBe("COR");
    expect(extractTicketKey("PROJ12-7: multi-part key")).toBe("PROJ12");
  });

  it("excludes skipped merge commits from the 30% threshold denominator", () => {
    // 3 of 5 real commits are Conventional Commits. If the 2 merge commits were
    // counted the denominator would be 5 and the 30% threshold would be 1, so the
    // assertion that matters is the inverse: a repo that is *mostly* merges must
    // still reach the convention on its minority of real commits.
    const mergeHeavy = [
      "Merge pull request #10 from owner/main",
      "Merge pull request #11 from owner/main",
      "Merge branch 'main' into work",
      "Merge pull request #12 from owner/main",
      "Merge pull request #13 from owner/main",
      "Merge branch 'release' into work",
      "Merge pull request #14 from owner/main",
      "Merge pull request #15 from owner/main",
      "Merge pull request #16 from owner/main",
      "feat: add the scan pipeline",
    ];

    const result = parseCommits(mergeHeavy);
    expect(result.conventional).toBe(true);
  });

  it("returns all-false when every commit is skipped", () => {
    const allMerges = [
      "Merge pull request #1 from owner/main",
      "Merge branch 'main' into work",
      "",
    ];

    const result = parseCommits(allMerges);
    expect(result).toEqual({ conventional: false, ticketPrefix: false, samplePrefixes: [] });
  });
});

describe("lint-format detector", () => {
  it("recognizes prettier.config variants", () => {
    const variants = [
      ["prettier.config.js"],
      ["prettier.config.cjs"],
      ["prettier.config.mjs"],
      ["prettier.config.ts"],
    ];

    for (const files of variants) {
      const detected = detectLintFormat(files);
      expect(detected.prettier).toBe(true);
    }
  });

  it("detects eslint, prettier, biome, and editorconfig", () => {
    const files = [
      "eslint.config.mjs",
      ".prettierrc",
      "biome.jsonc",
      ".editorconfig",
    ];

    const detected = detectLintFormat(files);
    expect(detected.eslint).toBe(true);
    expect(detected.prettier).toBe(true);
    expect(detected.biome).toBe(true);
    expect(detected.editorconfig).toBe(true);
  });
});
