// @vitest-environment node
import { describe, expect, it } from "vitest";
import { criteriaFromGoalExtracted } from "./contract";
import { GOAL_UNCLEAR_TITLE, type GoalExtracted } from "./types";

function extracted(overrides: Partial<GoalExtracted> = {}): GoalExtracted {
  return {
    title: "Add empty-scan save guard",
    scope: ["lib/repo-profile/save-policy.ts"],
    acceptanceCriteria: [
      "Refuse to save an empty scan result",
      "npm test lib/repo-profile/save-policy.test.ts covers the refusal",
    ],
    assumptions: [],
    ambiguityFlags: [],
    ...overrides,
  };
}

describe("criteriaFromGoalExtracted", () => {
  it("returns no criteria for a skipped-extraction goal", () => {
    expect(criteriaFromGoalExtracted(null)).toEqual([]);
  });

  it("carries every criterion across with sequential ids", () => {
    const criteria = criteriaFromGoalExtracted(extracted());

    expect(criteria).toHaveLength(2);
    expect(criteria.map((c) => c.id)).toEqual(["1", "2"]);
    expect(criteria[0].text).toBe("Refuse to save an empty scan result");
  });

  it("tags a criterion that mentions tests as a testing row", () => {
    const criteria = criteriaFromGoalExtracted(extracted());

    expect(criteria[0].category).toBe("functional");
    expect(criteria[1].category).toBe("testing");
  });

  it("recognises coverage and spec wording too", () => {
    const criteria = criteriaFromGoalExtracted(
      extracted({
        acceptanceCriteria: ["Add coverage for the empty scan", "Write a spec for the refusal"],
      })
    );

    expect(criteria.map((c) => c.category)).toEqual(["testing", "testing"]);
  });

  it("trims and drops blank criterion lines", () => {
    const criteria = criteriaFromGoalExtracted(
      extracted({ acceptanceCriteria: ["  real criterion  ", "   ", ""] })
    );

    expect(criteria).toHaveLength(1);
    expect(criteria[0].text).toBe("real criterion");
    expect(criteria[0].id).toBe("1");
  });

  it("produces nothing for an UNCLEAR goal with no criteria", () => {
    expect(
      criteriaFromGoalExtracted(
        extracted({
          title: GOAL_UNCLEAR_TITLE,
          acceptanceCriteria: [],
          ambiguityFlags: ["no target system mentioned"],
        })
      )
    ).toEqual([]);
  });
});