// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseCommits } from "./parsers/commit";
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
