import { RepoProfile } from "@/lib/types/steering";
import { isProfileEmpty, SaveDecision } from "./save-policy";
import { ScanOutcome } from "./types";

/**
 * The scan-result -> vault write flow, as a pure state machine.
 *
 * Everything the operator can do to a scanned profile is decided here rather than
 * inside the React component, so the rules below are unit-testable without a DOM:
 *
 *   - nothing is written until the operator confirms, except a *complete* scan of
 *     a repository that has no saved profile yet (there is nothing to overwrite);
 *   - a complete scan never silently overwrites an existing saved profile;
 *   - a partial scan may replace a *complete* saved profile, but only behind a
 *     second, explicit confirmation that names what is lost;
 *   - an empty scan is never writable, by any route;
 *   - the UI only claims "Saved" once the write has actually resolved.
 */
export type SavePhase =
  /** No decision yet: the scan is running, or profile listing failed. */
  | "loading"
  /** A decision exists and is waiting on the operator. */
  | "ready"
  /** A write is in flight. */
  | "saving"
  /** The write resolved successfully. */
  | "saved";

export interface SaveFlowState {
  phase: SavePhase;
  decision: SaveDecision | null;
  /** The already-saved profile for the same repo, if any. */
  existing: RepoProfile | null;
  /** The operator is looking at the second step of a destructive replace. */
  confirmPending: boolean;
  error: string | null;
  notice: string | null;
}

export type SaveFlowEvent =
  | { type: "scan_started" }
  | {
      type: "scan_settled";
      decision: SaveDecision;
      existing: RepoProfile | null;
      autoSave: boolean;
      outcome: ScanOutcome;
    }
  | { type: "save_requested" }
  | { type: "confirm_cancelled" }
  | { type: "save_committed" }
  | { type: "save_succeeded" }
  | { type: "save_failed"; message: string }
  | { type: "dismissed" };

export type SaveActionKind =
  | "loading"
  | "saving"
  | "saved"
  | "empty"
  | "save-complete"
  | "save-partial"
  | "replace-complete"
  | "replace-partial"
  | "replace-partial-confirm";

export interface SaveAction {
  kind: SaveActionKind;
  label: string;
  disabled: boolean;
  /** True when the operator must confirm a second time before the write runs. */
  requiresConfirm: boolean;
  /** Shown while `requiresConfirm` is true, naming what the replace destroys. */
  lossWarning?: string;
}

export const initialSaveFlowState: SaveFlowState = {
  phase: "loading",
  decision: null,
  existing: null,
  confirmPending: false,
  error: null,
  notice: null,
};

/**
 * Auto-save is limited to a complete scan of a repository with no saved profile.
 * Anything that would overwrite existing operator data requires a click.
 */
export function shouldAutoSave(
  decision: SaveDecision,
  existing: RepoProfile | null,
  outcome: ScanOutcome
): boolean {
  return outcome === "complete" && decision.action === "save" && existing === null;
}

/**
 * Names exactly what a destructive replace throws away, so the confirmation is
 * specific rather than a generic "are you sure".
 */
export function describeReplacementLoss(
  existing: RepoProfile,
  candidate: RepoProfile & { incomplete?: boolean }
): string {
  const savedCount = existing.conventions.length;
  const incomingCount = candidate.conventions.length;
  const savedDate = existing.updatedAt
    ? new Date(existing.updatedAt).toLocaleDateString()
    : "an earlier date";
  const keptInstructions = existing.customInstructions
    ? " Your custom instructions are carried over."
    : "";

  return (
    `This replaces the complete profile saved on ${savedDate}. ` +
    `${savedCount} saved convention${savedCount === 1 ? "" : "s"} ` +
    `${savedCount === 1 ? "is" : "are"} overwritten by ${incomingCount} ` +
    `detected in this incomplete scan, and the saved profile is marked incomplete. ` +
    `This cannot be undone.${keptInstructions}`
  );
}

/**
 * The notice shown once a scan settles. Replaces the previous version's
 * unreachable "Nothing meaningful was collected" branch: the skip path over a
 * complete saved profile is covered by the "kept your saved profile" case.
 *
 * A `cancelled` or `timed_out` outcome does not imply an empty profile: a scan
 * stopped in Stage 2 or later has already captured Stage 1 data (and possibly
 * more). Only claim nothing was collected when the profile is actually empty
 * (`isProfileEmpty`); otherwise say the scan stopped with partial data that has
 * not been saved yet. A stopped scan is never auto-saved, so "not saved yet" is
 * accurate whether or not an incomplete profile already exists.
 */
export function describeOutcomeNotice({
  outcome,
  decision,
  existing,
  autoSave,
}: {
  outcome: ScanOutcome;
  decision: SaveDecision;
  existing: RepoProfile | null;
  autoSave: boolean;
}): string {
  if (decision.action === "skip" && existing && !existing.incomplete) {
    const date = existing.updatedAt
      ? new Date(existing.updatedAt).toLocaleDateString()
      : "earlier";
    return `Kept your saved profile from ${date}`;
  }
  if (outcome === "cancelled" || outcome === "timed_out") {
    if (isProfileEmpty(decision.profile)) {
      return "Cancelled before any data was collected. Nothing saved.";
    }
    const stopped = outcome === "cancelled" ? "cancelled" : "timed out";
    return `Scan ${stopped} with partial data collected. Nothing has been saved yet; review it below, then choose Save to keep it.`;
  }
  if (autoSave) {
    return "Saving scan result...";
  }
  return "Review this scan below, then choose Save to keep it.";
}

function replacementNotice(state: SaveFlowState): string {
  const profile = state.decision?.profile;
  const replacedExisting = state.existing !== null;
  if (!profile) return "Saved profile.";
  if (!profile.incomplete) return "Scan completed and profile saved.";
  return replacedExisting
    ? "Replaced saved profile with this partial scan."
    : "Saved incomplete profile.";
}

export function saveFlowReducer(
  state: SaveFlowState,
  event: SaveFlowEvent
): SaveFlowState {
  switch (event.type) {
    case "scan_started":
      return { ...initialSaveFlowState };

    case "scan_settled":
      return {
        phase: event.autoSave ? "saving" : "ready",
        decision: event.decision,
        existing: event.existing,
        confirmPending: false,
        error: null,
        notice: describeOutcomeNotice({
          outcome: event.outcome,
          decision: event.decision,
          existing: event.existing,
          autoSave: event.autoSave,
        }),
      };

    case "save_requested":
      // Only a destructive replace pauses for confirmation; everything else runs.
      return resolveSaveAction(state).requiresConfirm
        ? { ...state, confirmPending: true, error: null }
        : state;

    // The operator backed out of the second step; the saved profile is untouched.
    case "confirm_cancelled":
      return { ...state, confirmPending: false, error: null };

    case "save_committed":
      return { ...state, phase: "saving", confirmPending: false, error: null };

    // Reached only after the store write resolved, so "Saved" can never be shown
    // for a write that failed.
    case "save_succeeded":
      return {
        ...state,
        phase: "saved",
        confirmPending: false,
        error: null,
        notice: replacementNotice(state),
      };

    // Drop back to "ready" so the control is clickable again and the operator can
    // retry; with no decision there is nothing to retry and we stay disabled.
    case "save_failed":
      return {
        ...state,
        phase: state.decision ? "ready" : "loading",
        confirmPending: false,
        error: event.message,
      };

    case "dismissed":
      return { ...initialSaveFlowState };

    default:
      return state;
  }
}

/** The single source of truth for what the primary save control renders. */
export function resolveSaveAction(state: SaveFlowState): SaveAction {
  if (state.phase === "loading" || !state.decision) {
    return {
      kind: "loading",
      label: "Preparing save options...",
      disabled: true,
      requiresConfirm: false,
    };
  }

  if (state.phase === "saving") {
    return {
      kind: "saving",
      label: "Saving...",
      disabled: true,
      requiresConfirm: false,
    };
  }

  if (state.phase === "saved") {
    return {
      kind: "saved",
      label: "Saved",
      disabled: true,
      requiresConfirm: false,
    };
  }

  const candidate = state.decision.profile;
  const existing = state.existing;

  // An empty scan is never writable, whatever the decision says.
  if (isProfileEmpty(candidate)) {
    return {
      kind: "empty",
      label: "Nothing to save from this scan",
      disabled: true,
      requiresConfirm: false,
    };
  }

  const existingIsComplete = existing !== null && !existing.incomplete;
  const candidateIsIncomplete = Boolean(candidate.incomplete);

  if (existingIsComplete && candidateIsIncomplete) {
    const lossWarning = describeReplacementLoss(existing!, candidate);
    return state.confirmPending
      ? {
          kind: "replace-partial-confirm",
          label: "Yes, replace my saved profile",
          disabled: false,
          requiresConfirm: true,
          lossWarning,
        }
      : {
          kind: "replace-partial",
          label: "Replace saved profile with this partial",
          disabled: false,
          requiresConfirm: true,
          lossWarning,
        };
  }

  if (existingIsComplete) {
    return {
      kind: "replace-complete",
      label: "Save and replace saved profile",
      disabled: false,
      requiresConfirm: false,
    };
  }

  if (candidateIsIncomplete) {
    return {
      kind: "save-partial",
      label: "Save partial profile",
      disabled: false,
      requiresConfirm: false,
    };
  }

  return {
    kind: "save-complete",
    label: "Save profile",
    disabled: false,
    requiresConfirm: false,
  };
}
