import {
  GOAL_CONVENTIONS_MAX,
  GOAL_CONVENTION_BODY_MAX,
  GOAL_RAW_TEXT_MAX,
  GOAL_UNCLEAR_TITLE,
  type GoalExtracted,
} from '@/lib/goals/types';
import type { RepoProfile } from '@/lib/types/steering';

/**
 * COR-56 goal extraction prompt.
 *
 * The extractor turns an operator's freeform ticket text into the structured
 * `GoalExtracted` shape that Stage 2 later audits against. When a saved
 * COR-54 `RepoProfile` is available it is injected as grounding so the model
 * cites real files, real conventions, and the repository's real test command
 * instead of inventing plausible-looking paths.
 */

const JS_TEST_RUNNERS = /^(vitest|jest|mocha|ava|uvu|karma|node --test)/i;

export const GOAL_EXTRACT_SYSTEM_PROMPT = `You are RepoPilot Goal Ingestion Engine. You convert an operator's freeform task description into a structured goal that an autonomous coding agent can execute and that an automated audit engine can later score against.

OUTPUT CONTRACT
Return a single JSON object with exactly these keys:
{
  "title": string,
  "scope": string[],
  "acceptanceCriteria": string[],
  "assumptions": string[],
  "ambiguityFlags": string[]
}

FIELD RULES
1. "title" — a short imperative summary of the goal (for example "Add empty-scan save guard"). Keep it under 120 characters.
   CRITICAL: if the input is too vague, ambiguous, or carries no actionable detail (for example "make it better", "fix stuff", "just do the work"), you MUST set "title" to "${GOAL_UNCLEAR_TITLE}".
2. "scope" — the files, modules, endpoints, or components expected to change. Use real paths from the repository profile when one is supplied. Never invent paths.
3. "acceptanceCriteria" — verifiable bullet points. Each must state WHAT is true and HOW it is checked (a test file, a command, a response code, a named function). When a repository profile supplies a test command or test runner, cite that exact command form in at least one criterion.
4. "assumptions" — every default, constraint, or fact you inferred because the input did not state it. Never silently invent metrics, limits, file names, or behaviours: if you had to assume it, it goes here.
5. "ambiguityFlags" — when "title" is "${GOAL_UNCLEAR_TITLE}" this MUST be non-empty and must name the specific missing details. When the goal is clear, return an empty array.

OUTPUT FORMAT
Return raw JSON only. No markdown code fences, no prose before or after the object.`;

/**
 * The repository's real verification command, derived from what the profile
 * actually detected. Falls back to the brief's canonical npm example only when
 * a package manager is known and no non-JavaScript runner was detected.
 */
export function buildExampleTestCommand(profile?: RepoProfile): string {
  const packageManager = profile?.stack?.packageManager?.trim() || '';
  const testRunner = profile?.stack?.testRunner?.trim() || '';
  if (testRunner && !JS_TEST_RUNNERS.test(testRunner)) {
    return `${testRunner} ./path/to/file`;
  }
  return `${packageManager || 'npm'} test lib/example.test.ts`;
}

/**
 * Renders a saved repo profile as prompt context. Returns an empty string when
 * no profile is supplied so the caller can omit the section entirely.
 */
export function formatRepoProfileContext(profile?: RepoProfile): string {
  if (!profile) return '';

  const lines: string[] = [];
  const repoLabel = `${profile.repoRef?.owner ?? 'unknown'}/${profile.repoRef?.repo ?? 'unknown'}`;
  lines.push(`- Repository: ${repoLabel}`);

  const languages = (profile.stack?.languages ?? []).filter(Boolean);
  if (languages.length > 0) {
    lines.push(`- Languages: ${languages.slice(0, 12).join(', ')}`);
  }
  const stackBits = [
    profile.stack?.framework ? `framework ${profile.stack.framework}` : '',
    profile.stack?.packageManager ? `package manager ${profile.stack.packageManager}` : '',
    profile.stack?.testRunner ? `test runner ${profile.stack.testRunner}` : '',
  ].filter(Boolean);
  if (stackBits.length > 0) {
    lines.push(`- Tooling: ${stackBits.join(', ')}`);
  }

  const conventions = (profile.conventions ?? []).filter((c) => c.title || c.body);
  if (conventions.length > 0) {
    lines.push('- Conventions detected in this repository:');
    for (const convention of conventions.slice(0, GOAL_CONVENTIONS_MAX)) {
      const body = convention.body.replace(/\s+/g, ' ').trim().slice(0, GOAL_CONVENTION_BODY_MAX);
      lines.push(`  * ${convention.title}: ${body}`);
    }
  }

  if (profile.customInstructions?.trim()) {
    lines.push(`- Operator instructions for this repository: ${profile.customInstructions.trim()}`);
  }
  if (profile.notes?.trim()) {
    lines.push(`- Profile notes: ${profile.notes.trim()}`);
  }

  return lines.join('\n');
}

export interface GoalExtractPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export function buildGoalExtractPrompt(
  rawText: string,
  repoProfile?: RepoProfile
): GoalExtractPrompt {
  const text = rawText.trim().slice(0, GOAL_RAW_TEXT_MAX);
  const profileContext = formatRepoProfileContext(repoProfile);

  const systemPrompt = profileContext
    ? `${GOAL_EXTRACT_SYSTEM_PROMPT}

REPOSITORY PROFILE (detected — treat as ground truth; never contradict or invent paths outside it)
${profileContext}

VERIFICATION COMMAND
The repository's own test command form is \`${buildExampleTestCommand(repoProfile)}\`. At least one acceptance criterion must cite a command in this form.`
    : GOAL_EXTRACT_SYSTEM_PROMPT;

  const userPrompt = profileContext
    ? `Extract the goal from the operator's description below, grounding it in the repository profile above.

=== REPOSITORY PROFILE ===
${profileContext}

=== OPERATOR DESCRIPTION ===
${text}`
    : `Extract the goal from the operator's description below. No repository profile is available, so keep "scope" and "acceptanceCriteria" stack-agnostic and do not name specific file paths.

=== OPERATOR DESCRIPTION ===
${text}`;

  return { systemPrompt, userPrompt };
}

/** Convenience type alias so callers do not import `GoalExtracted` separately. */
export type ExtractedGoal = GoalExtracted;