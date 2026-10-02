// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  describeOutcomeNotice,
  describeReplacementLoss,
  initialSaveFlowState,
  resolveSaveAction,
  saveFlowReducer,
  shouldAutoSave,
  SaveFlowState,
} from "./save-flow";
import { decideSave, EMPTY_REPLACE_MESSAGE } from "./save-policy";
import { ScanResult } from "./types";
import { RepoProfile } from "@/lib/types/steering";

type MutableProfile = RepoProfile & { incomplete?: boolean };

function completeProfile(overrides?: Partial<MutableProfile>): MutableProfile {
  return {
    id: "foo/bar",
    repoRef: { owner: "foo", repo: "bar", defaultBranch: "main" },
    stack: { languages: ["TypeScript"], framework: "next" },
    conventions: [
      { id: "manifest", title: "Manifest", body: "Name: bar", source: "package.json" },
      { id: "commits", title: "Commits", body: "Conventional Commits.", source: "git commits" },
      { id: "lint-format", title: "Lint", body: "Uses ESLint.", source: "Root configs" },
    ],
    updatedAt: "2026-03-30T10:00:00Z",
    version: 1,
    ...overrides,
  };
}

/** The shape an early cancel/timeout produces: nothing collected at all. */
function emptyCancelledResult(): ScanResult {
  return {
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
}

function completeResult(): ScanResult {
  return {
    profile: completeProfile(),
    outcome: "complete",
    issues: [],
  };
}

/** Near-empty: Stage 1 captured the branch, nothing else. */
function branchOnlyResult(): ScanResult {
  return {
    profile: {
      id: "foo/bar",
      repoRef: { owner: "foo", repo: "bar", defaultBranch: "main" },
      stack: { languages: [] },
      conventions: [],
      updatedAt: "2026-03-30T10:00:00Z",
      version: 1,
      incomplete: true,
    },
    outcome: "cancelled",
    issues: [],
  };
}

/** A scan stopped in Stage 2 or later: Stage 1 metadata plus manifest data. */
function stageTwoPartialResult(outcome: "cancelled" | "timed_out"): ScanResult {
  return {
    profile: {
      id: "foo/bar",
      repoRef: { owner: "foo", repo: "bar", defaultBranch: "main" },
      stack: { languages: ["TypeScript"], packageManager: "npm" },
      conventions: [
        { id: "manifest", title: "Manifest", body: "Name: bar", source: "package.json" },
      ],
      updatedAt: "2026-03-30T10:00:00Z",
      version: 1,
      incomplete: true,
    },
    outcome,
    issues: [],
  };
}

function settled(overrides: {
  decision: ReturnType<typeof decideSave>;
  existing: RepoProfile | null;
  autoSave?: boolean;
  outcome?: ScanResult["outcome"];
}): SaveFlowState {
  return saveFlowReducer(initialSaveFlowState, {
    type: "scan_settled",
    decision: overrides.decision,
    existing: overrides.existing,
    autoSave: overrides.autoSave ?? false,
    outcome: overrides.outcome ?? "complete",
  });
}

describe("shouldAutoSave", () => {
  it("auto-saves a complete scan only when no profile exists yet", () => {
    const decision = decideSave(null, completeResult());
    expect(shouldAutoSave(decision, null, "complete")).toBe(true);
  });

  it("never auto-saves over an existing saved profile", () => {
    const existing = completeProfile();
    const decision = decideSave(existing, completeResult());
    // The policy says "save", but writing over the operator's data needs a click.
    expect(decision.action).toBe("save");
    expect(shouldAutoSave(decision, existing, "complete")).toBe(false);
  });

  it("never auto-saves an incomplete scan", () => {
    const decision = decideSave(null, branchOnlyResult());
    expect(shouldAutoSave(decision, null, "cancelled")).toBe(false);
    expect(shouldAutoSave(decision, null, "partial")).toBe(false);
    expect(shouldAutoSave(decision, null, "timed_out")).toBe(false);
  });
});

describe("resolveSaveAction - an empty cancel can never be saved", () => {
  it("disables the control and shows the empty state for an early cancel", () => {
    const state = settled({
      decision: decideSave(null, emptyCancelledResult()),
      existing: null,
      outcome: "cancelled",
    });

    const action = resolveSaveAction(state);
    expect(action.kind).toBe("empty");
    expect(action.disabled).toBe(true);
    expect(action.label).toBe("Nothing to save from this scan");
  });

  it("stays disabled for an empty cancel even when a complete profile exists", () => {
    const existing = completeProfile();
    const state = settled({
      decision: decideSave(existing, emptyCancelledResult()),
      existing,
      outcome: "cancelled",
    });

    const action = resolveSaveAction(state);
    expect(action.kind).toBe("empty");
    expect(action.disabled).toBe(true);
    expect(action.requiresConfirm).toBe(false);
  });

  it("stays disabled while the operator is mid-confirm on an empty profile", () => {
    const existing = completeProfile();
    let state = settled({
      decision: decideSave(existing, branchOnlyResult()),
      existing,
      outcome: "cancelled",
    });
    state = saveFlowReducer(state, { type: "save_requested" });
    expect(state.confirmPending).toBe(true);

    // Even if a stale confirm flag were set, emptiness wins.
    const forced: SaveFlowState = { ...state, decision: decideSave(existing, emptyCancelledResult()) };
    expect(resolveSaveAction(forced).kind).toBe("empty");
  });

  it("refuses the write and surfaces the policy message if one is forced through", () => {
    const state = settled({
      decision: decideSave(null, branchOnlyResult()),
      existing: null,
      outcome: "cancelled",
    });

    // The reducer's guard is the last line of defence before the store call.
    const afterFailure = saveFlowReducer(state, {
      type: "save_failed",
      message: EMPTY_REPLACE_MESSAGE,
    });
    expect(afterFailure.error).toBe(EMPTY_REPLACE_MESSAGE);
    expect(afterFailure.phase).not.toBe("saved");
  });
});

describe("resolveSaveAction - a failed save never shows Saved", () => {
  function inFlightState() {
    const state = settled({
      decision: decideSave(null, completeResult()),
      existing: null,
      autoSave: true,
    });
    expect(state.phase).toBe("saving");
    return saveFlowReducer(state, { type: "save_committed" });
  }

  it("shows 'Saving...' while the write is in flight", () => {
    const action = resolveSaveAction(inFlightState());
    expect(action.kind).toBe("saving");
    expect(action.label).toBe("Saving...");
    expect(action.disabled).toBe(true);
  });

  it("shows 'Saved' only after the write resolves", () => {
    const resolved = saveFlowReducer(inFlightState(), { type: "save_succeeded" });
    const action = resolveSaveAction(resolved);
    expect(action.kind).toBe("saved");
    expect(action.label).toBe("Saved");
  });

  it("keeps the control enabled and does not say Saved when the write fails", () => {
    const failed = saveFlowReducer(inFlightState(), {
      type: "save_failed",
      message: "IndexedDB quota exceeded",
    });

    const action = resolveSaveAction(failed);
    expect(action.kind).toBe("save-complete");
    expect(action.label).not.toBe("Saved");
    expect(action.disabled).toBe(false);
    expect(failed.phase).toBe("ready");
    expect(failed.error).toBe("IndexedDB quota exceeded");
  });

  it("reports the write failure from an operator-initiated save too", () => {
    const ready = settled({
      decision: decideSave(null, branchOnlyResult()),
      existing: null,
      outcome: "cancelled",
    });
    const failed = saveFlowReducer(saveFlowReducer(ready, { type: "save_committed" }), {
      type: "save_failed",
      message: "disk full",
    });

    expect(resolveSaveAction(failed).label).toBe("Save partial profile");
    expect(resolveSaveAction(failed).disabled).toBe(false);
    expect(failed.phase).not.toBe("saved");
  });
});

describe("resolveSaveAction - the control is disabled while saveDecision is null", () => {
  it("is disabled on the initial loading state", () => {
    const action = resolveSaveAction(initialSaveFlowState);
    expect(action.kind).toBe("loading");
    expect(action.disabled).toBe(true);
    expect(action.label).toBe("Preparing save options...");
  });

  it("is disabled immediately after a scan starts, before any decision exists", () => {
    const started = saveFlowReducer(
      settled({ decision: decideSave(null, completeResult()), existing: null }),
      { type: "scan_started" }
    );
    expect(started.decision).toBeNull();
    expect(resolveSaveAction(started).disabled).toBe(true);
  });

  it("stays disabled after a failure that leaves no decision to retry", () => {
    const failed = saveFlowReducer(initialSaveFlowState, {
      type: "save_failed",
      message: "profile list unavailable",
    });
    expect(failed.phase).toBe("loading");
    expect(resolveSaveAction(failed).disabled).toBe(true);
  });

  it("treats a decision-less state as disabled even if the phase says ready", () => {
    const inconsistent: SaveFlowState = { ...initialSaveFlowState, phase: "ready" };
    expect(resolveSaveAction(inconsistent).disabled).toBe(true);
  });
});

describe("resolveSaveAction - a complete scan over an existing profile needs a click", () => {
  it("offers 'Save and replace saved profile' rather than auto-saving", () => {
    const existing = completeProfile();
    const state = settled({
      decision: decideSave(existing, completeResult()),
      existing,
      autoSave: false,
    });

    const action = resolveSaveAction(state);
    expect(action.kind).toBe("replace-complete");
    expect(action.label).toBe("Save and replace saved profile");
    expect(action.disabled).toBe(false);
    expect(action.requiresConfirm).toBe(false);
    expect(state.phase).toBe("ready");
  });

  it("does not enter the saving phase without a click", () => {
    const existing = completeProfile();
    const state = settled({
      decision: decideSave(existing, completeResult()),
      existing,
      autoSave: false,
    });
    expect(state.phase).toBe("ready");
  });
});

describe("resolveSaveAction - a near-empty partial over a complete profile needs confirmation", () => {
  function replacePartialState() {
    const existing = completeProfile({ customInstructions: "always use npm" });
    return settled({
      decision: decideSave(existing, branchOnlyResult()),
      existing,
      outcome: "cancelled",
    });
  }

  it("asks first, and names what will be lost", () => {
    const state = replacePartialState();

    const first = resolveSaveAction(state);
    expect(first.kind).toBe("replace-partial");
    expect(first.label).toBe("Replace saved profile with this partial");
    expect(first.requiresConfirm).toBe(true);
    expect(first.lossWarning).toContain("3 saved conventions");
    expect(first.lossWarning).toContain("0 detected in this incomplete scan");
    expect(first.lossWarning).toContain("custom instructions are carried over");
  });

  it("shows the explicit confirmation step only after the first click", () => {
    const state = replacePartialState();
    expect(state.confirmPending).toBe(false);

    const asked = saveFlowReducer(state, { type: "save_requested" });
    expect(asked.confirmPending).toBe(true);

    const confirmed = resolveSaveAction(asked);
    expect(confirmed.kind).toBe("replace-partial-confirm");
    expect(confirmed.label).toBe("Yes, replace my saved profile");
    expect(confirmed.lossWarning).toBeTruthy();
  });

  it("still does not write until the confirmation is committed", () => {
    const asked = saveFlowReducer(replacePartialState(), { type: "save_requested" });
    expect(asked.phase).toBe("ready");

    const committed = saveFlowReducer(asked, { type: "save_committed" });
    expect(committed.phase).toBe("saving");
  });

  it("leaves the saved profile untouched when the operator backs out", () => {
    const asked = saveFlowReducer(replacePartialState(), { type: "save_requested" });
    const backedOut = saveFlowReducer(asked, { type: "confirm_cancelled" });

    expect(backedOut.confirmPending).toBe(false);
    expect(backedOut.phase).toBe("ready");
    expect(resolveSaveAction(backedOut).kind).toBe("replace-partial");
  });

  it("only steps into the confirm state for actions that require it", () => {
    const plain = settled({
      decision: decideSave(null, completeResult()),
      existing: null,
      autoSave: false,
    });
    const unchanged = saveFlowReducer(plain, { type: "save_requested" });
    expect(unchanged.confirmPending).toBe(false);
  });
});

describe("resolveSaveAction - other states", () => {
  it("offers a plain save for a first complete profile when auto-save is off", () => {
    const state = settled({
      decision: decideSave(null, completeResult()),
      existing: null,
      autoSave: false,
    });
    expect(resolveSaveAction(state).kind).toBe("save-complete");
  });

  it("offers a plain save for a partial scan with no existing profile", () => {
    const state = settled({
      decision: decideSave(null, branchOnlyResult()),
      existing: null,
      outcome: "cancelled",
    });
    const action = resolveSaveAction(state);
    expect(action.kind).toBe("save-partial");
    expect(action.requiresConfirm).toBe(false);
  });

  it("replaces an existing incomplete profile without confirmation", () => {
    const existing = completeProfile({ incomplete: true, conventions: [] });
    const state = settled({
      decision: decideSave(existing, branchOnlyResult()),
      existing,
      outcome: "cancelled",
    });
    expect(resolveSaveAction(state).kind).toBe("save-partial");
  });
});

describe("describeReplacementLoss", () => {
  it("counts conventions and mentions the saved date", () => {
    const warning = describeReplacementLoss(completeProfile(), branchOnlyResult().profile);
    expect(warning).toContain("3 saved conventions are overwritten");
    expect(warning).toContain("This cannot be undone");
  });

  it("uses singular wording for a single saved convention", () => {
    const existing = completeProfile({ conventions: [completeProfile().conventions[0]] });
    const warning = describeReplacementLoss(existing, branchOnlyResult().profile);
    expect(warning).toContain("1 saved convention is overwritten");
  });
});

describe("describeOutcomeNotice", () => {
  it("says the saved profile was kept when a partial scan was skipped", () => {
    const existing = completeProfile();
    const notice = describeOutcomeNotice({
      outcome: "cancelled",
      decision: decideSave(existing, branchOnlyResult()),
      existing,
      autoSave: false,
    });
    expect(notice).toMatch(/^Kept your saved profile from /);
  });

  it("says nothing was collected for an early cancel", () => {
    const notice = describeOutcomeNotice({
      outcome: "cancelled",
      decision: decideSave(null, emptyCancelledResult()),
      existing: null,
      autoSave: false,
    });
    expect(notice).toBe("Cancelled before any data was collected. Nothing saved.");
  });

  it("says it timed out before any data was collected for an empty Stage-1 timeout", () => {
    const notice = describeOutcomeNotice({
      outcome: "timed_out",
      decision: decideSave(null, { ...emptyCancelledResult(), outcome: "timed_out" }),
      existing: null,
      autoSave: false,
    });
    expect(notice).toBe("Timed out before any data was collected. Nothing saved.");
  });

  it("says it timed out before any data was collected for an empty timeout over an incomplete saved profile", () => {
    const existing = completeProfile({ incomplete: true });
    const notice = describeOutcomeNotice({
      outcome: "timed_out",
      decision: decideSave(existing, { ...emptyCancelledResult(), outcome: "timed_out" }),
      existing,
      autoSave: false,
    });
    expect(notice).toBe("Timed out before any data was collected. Nothing saved.");
  });

  it("keeps the nothing-collected copy for an empty cancel over an incomplete saved profile", () => {
    const existing = completeProfile({ incomplete: true });
    const notice = describeOutcomeNotice({
      outcome: "cancelled",
      decision: decideSave(existing, emptyCancelledResult()),
      existing,
      autoSave: false,
    });
    expect(notice).toBe("Cancelled before any data was collected. Nothing saved.");
  });

  it("says partial data was collected for a Stage-2+ cancel with no saved profile", () => {
    const notice = describeOutcomeNotice({
      outcome: "cancelled",
      decision: decideSave(null, stageTwoPartialResult("cancelled")),
      existing: null,
      autoSave: false,
    });
    expect(notice).toBe(
      "Scan cancelled with partial data collected. Nothing has been saved yet; review it below, then choose Save to keep it."
    );
    expect(notice).not.toMatch(/before any data was collected/);
  });

  it("says partial data was collected for a Stage-2+ timeout with no saved profile", () => {
    const notice = describeOutcomeNotice({
      outcome: "timed_out",
      decision: decideSave(null, stageTwoPartialResult("timed_out")),
      existing: null,
      autoSave: false,
    });
    expect(notice).toBe(
      "Scan timed out with partial data collected. Nothing has been saved yet; review it below, then choose Save to keep it."
    );
  });

  it("says partial data was collected for a Stage-2+ cancel over an incomplete saved profile", () => {
    const existing = completeProfile({ incomplete: true });
    const notice = describeOutcomeNotice({
      outcome: "cancelled",
      decision: decideSave(existing, stageTwoPartialResult("cancelled")),
      existing,
      autoSave: false,
    });
    expect(notice).toBe(
      "Scan cancelled with partial data collected. Nothing has been saved yet; review it below, then choose Save to keep it."
    );
  });

  it("says partial data was collected for a Stage-2+ timeout over an incomplete saved profile", () => {
    const existing = completeProfile({ incomplete: true });
    const notice = describeOutcomeNotice({
      outcome: "timed_out",
      decision: decideSave(existing, stageTwoPartialResult("timed_out")),
      existing,
      autoSave: false,
    });
    expect(notice).toBe(
      "Scan timed out with partial data collected. Nothing has been saved yet; review it below, then choose Save to keep it."
    );
  });

  it("leaves the save control and reducer state unchanged for a Stage-2+ partial cancel", () => {
    const state = settled({
      decision: decideSave(null, stageTwoPartialResult("cancelled")),
      existing: null,
      outcome: "cancelled",
    });
    expect(state.phase).toBe("ready");
    expect(state.notice).toMatch(/^Scan cancelled with partial data collected\./);
    expect(resolveSaveAction(state).kind).toBe("save-partial");
  });

  describe("with a complete profile already saved", () => {
    const existing = completeProfile();
    const keptNotice = `Kept your saved profile from ${new Date(
      "2026-03-30T10:00:00Z"
    ).toLocaleDateString()}`;

    function settledOver(result: ScanResult): SaveFlowState {
      return settled({
        decision: decideSave(existing, result),
        existing,
        outcome: result.outcome,
      });
    }

    it("keeps the saved profile and disables the control for an empty cancel", () => {
      const state = settledOver(emptyCancelledResult());
      expect(state.notice).toBe(keptNotice);
      const action = resolveSaveAction(state);
      expect(action.kind).toBe("empty");
      expect(action.label).toBe("Nothing to save from this scan");
      expect(action.disabled).toBe(true);
    });

    it("keeps the saved profile and disables the control for an empty timeout", () => {
      const state = settledOver({ ...emptyCancelledResult(), outcome: "timed_out" });
      expect(state.notice).toBe(keptNotice);
      const action = resolveSaveAction(state);
      expect(action.kind).toBe("empty");
      expect(action.label).toBe("Nothing to save from this scan");
      expect(action.disabled).toBe(true);
    });

    it("keeps the saved profile and offers a confirmed replace for a partial cancel", () => {
      const state = settledOver(stageTwoPartialResult("cancelled"));
      expect(state.notice).toBe(keptNotice);
      const action = resolveSaveAction(state);
      expect(action.kind).toBe("replace-partial");
      expect(action.label).toBe("Replace saved profile with this partial");
      expect(action.disabled).toBe(false);
      expect(action.requiresConfirm).toBe(true);
    });

    it("keeps the saved profile and offers a confirmed replace for a partial timeout", () => {
      const state = settledOver(stageTwoPartialResult("timed_out"));
      expect(state.notice).toBe(keptNotice);
      const action = resolveSaveAction(state);
      expect(action.kind).toBe("replace-partial");
      expect(action.label).toBe("Replace saved profile with this partial");
      expect(action.disabled).toBe(false);
      expect(action.requiresConfirm).toBe(true);
    });
  });

  it("never emits the removed 'Nothing meaningful was collected' copy", () => {
    // Every outcome must route to a reachable, meaningful message.
    const outcomes: ScanResult["outcome"][] = ["complete", "partial", "cancelled", "timed_out"];
    const existing = completeProfile();

    for (const outcome of outcomes) {
      for (const candidate of [completeResult(), branchOnlyResult(), emptyCancelledResult()]) {
        const result: ScanResult = { ...candidate, outcome };
        const notice = describeOutcomeNotice({
          outcome,
          decision: decideSave(existing, result),
          existing,
          autoSave: false,
        });
        expect(notice).not.toBe("Nothing meaningful was collected. Nothing saved.");
        expect(notice.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("saveFlowReducer - ordering guarantees", () => {
  it("does not report 'saved' from scan_settled, only from save_succeeded", () => {
    const state = settled({
      decision: decideSave(null, completeResult()),
      existing: null,
      autoSave: true,
    });
    // Auto-save is in flight: the reducer must not claim the profile is stored.
    expect(state.phase).toBe("saving");
    expect(resolveSaveAction(state).label).not.toBe("Saved");
  });

  it("clears everything on a new scan and on discard", () => {
    const ready = settled({ decision: decideSave(null, completeResult()), existing: null });
    expect(saveFlowReducer(ready, { type: "scan_started" })).toEqual(initialSaveFlowState);

    const saved = saveFlowReducer(ready, { type: "save_succeeded" });
    expect(saveFlowReducer(saved, { type: "dismissed" })).toEqual(initialSaveFlowState);
  });
});
