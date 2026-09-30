import { RepoProfile } from "@/lib/types/steering";
import { ScanResult } from "./types";

export const EMPTY_REPLACE_MESSAGE =
  "Cannot replace existing profile with an empty scan result.";

export interface SaveDecision {
  action: "save" | "skip";
  profile: RepoProfile & { incomplete?: boolean };
}

/**
 * A profile is "empty" when a cancelled or timed-out scan collected no meaningful
 * extracted data. `RepoProfile` carries no summary/scripts/dependencies fields, so
 * the meaningful signals are the default branch, detected languages, any tech-stack
 * detail, and detected conventions.
 */
export function isProfileEmpty(profile: RepoProfile & { incomplete?: boolean }): boolean {
  const hasBranch = Boolean(profile.repoRef.defaultBranch);
  const hasLanguages = (profile.stack.languages ?? []).length > 0;
  const hasConventions = (profile.conventions ?? []).length > 0;
  const hasStackInfo = Boolean(
    profile.stack.packageManager || profile.stack.framework || profile.stack.testRunner
  );
  return !hasBranch && !hasLanguages && !hasConventions && !hasStackInfo;
}

export function decideSave(
  existing: RepoProfile | null,
  result: ScanResult
): SaveDecision {
  const { outcome, profile } = result;

  // Prepare profile copy with id case-preservation / customInstructions carry-over
  const workingProfile: RepoProfile & { incomplete?: boolean } = {
    ...profile,
    ...(outcome !== "complete" ? { incomplete: true } : {}),
  };

  if (outcome === "complete") {
    delete workingProfile.incomplete;
  }

  // Id preservation: use existing id if matches case-insensitively
  if (existing && existing.id.toLowerCase() === profile.id.toLowerCase()) {
    workingProfile.id = existing.id;
  }

  // Custom instructions carry-over from existing profile if available
  if (existing?.customInstructions) {
    workingProfile.customInstructions = existing.customInstructions;
  }

  if (outcome === "complete") {
    return { action: "save", profile: workingProfile };
  }

  // Incomplete outcome rules
  if (isProfileEmpty(workingProfile)) {
    return { action: "skip", profile: workingProfile };
  }

  if (!existing) {
    return { action: "save", profile: workingProfile };
  }

  if (existing.incomplete) {
    return { action: "save", profile: workingProfile };
  }

  // Existing is complete, new is incomplete
  return { action: "skip", profile: workingProfile };
}
