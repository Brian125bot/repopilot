// @vitest-environment node
import { describe, it, expect } from "vitest";
import { validateAndParseRef } from "./ref";
import { ScanError } from "./types";

describe("ref validation (validateAndParseRef)", () => {
  it("validates correct owner and repo names and generates canonical lower-case ID", () => {
    const valid = validateAndParseRef({ owner: "Brian125bot", repo: "RepoPilot" });
    expect(valid.owner).toBe("Brian125bot");
    expect(valid.repo).toBe("RepoPilot");
    expect(valid.canonicalId).toBe("brian125bot/repopilot");
  });

  it("throws ScanError('invalid_ref') for invalid owners or repos", () => {
    const invalids = [
      { owner: "", repo: "repo" },
      { owner: "-invalid-start", repo: "repo" },
      { owner: "owner", repo: "." },
      { owner: "owner", repo: ".." },
      { owner: "owner", repo: "a/b" },
      { owner: "owner", repo: "a?b" },
    ];

    for (const target of invalids) {
      expect(() => validateAndParseRef(target)).toThrowError(
        expect.objectContaining({ name: "ScanError", code: "invalid_ref" })
      );
    }
  });
});
