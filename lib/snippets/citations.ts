import {
  MAX_MATCHED_KEYWORDS,
  STAGE_CATEGORY_AFFINITY,
  tokenize,
} from './ranking';
import {
  describeSessionStage,
  inferSessionStage,
  type SessionStage,
} from './state';
import type { RepoProfile, Snippet, SnippetCategory } from '@/lib/types/steering';

/**
 * COR-59 "Why this?" citations.
 *
 * Human-readable reasons a snippet was recommended. Every reason
 * is grounded in data the operator can see: the latest Jules
 * output, the ingested goal criteria, the saved repository
 * profile, and the operator's own usage history.
 *
 * Fail-soft constraint: `RepoProfile` is optional throughout.
 * A missing profile simply omits convention citations — it never
 * errors, warns, or degrades the other reasons.
 */

export type CitationKind =
  | 'goal_alignment'
  | 'tag_match'
  | 'repo_convention'
  | 'usage_history'
  | 'cold_start';

export interface CitationReason {
  kind: CitationKind;
  text: string;
}

/** Maximum reasons the "Why this?" tooltip renders. */
export const MAX_CITATION_REASONS = 4;

/** Minimum stage affinity for a category to be called out as a stage fit. */
export const STAGE_FIT_THRESHOLD = 0.6;

export interface CitationContext {
  /** Latest Jules message text. */
  latestMessage: string;
  /** Goal criteria captured by COR-56 goal ingestion, when present. */
  goalCriteria?: readonly string[];
  /** Pre-inferred session stage; inferred from latestMessage when omitted. */
  stage?: SessionStage;
  /**
   * Saved COR-54 repository profile. Optional by design: when
   * absent, repo-convention citations are omitted cleanly.
   */
  repoProfile?: RepoProfile;
  /** Operator usage history: snippet id → times used. */
  usageCounts?: ReadonlyMap<string, number>;
}

/** Meaningful tokens of a snippet's title and content. */
function snippetTokens(snippet: Snippet): Set<string> {
  return new Set([...tokenize(snippet.title), ...tokenize(snippet.content)]);
}

/** Keywords shared by the snippet and the latest Jules output. */
export function matchedKeywords(
  snippet: Snippet,
  latestMessage: string
): string[] {
  const messageTokens = tokenize(latestMessage);
  const tokens = snippetTokens(snippet);
  const matched: string[] = [];
  for (const token of messageTokens) {
    if (tokens.has(token) && !matched.includes(token)) {
      matched.push(token);
    }
  }
  return matched;
}

/** True when the snippet covers at least one criterion token. */
function matchesCriterion(snippet: Snippet, criterion: string): boolean {
  const criterionTokens = tokenize(criterion);
  if (criterionTokens.length === 0) return false;
  const tokens = snippetTokens(snippet);
  return criterionTokens.some((token) => tokens.has(token));
}

/** True when the snippet shares a token with a convention. */
function matchesConvention(
  snippet: Snippet,
  conventionTitle: string,
  conventionBody: string
): boolean {
  const conventionTokens = new Set([
    ...tokenize(conventionTitle),
    ...tokenize(conventionBody),
  ]);
  if (conventionTokens.size === 0) return false;
  const tokens = snippetTokens(snippet);
  for (const token of tokens) {
    if (conventionTokens.has(token)) return true;
  }
  return false;
}

/** Stage affinity for a category, mirroring the ranking prior. */
function stageAffinityFor(
  stage: SessionStage,
  category: SnippetCategory
): number {
  return STAGE_CATEGORY_AFFINITY[stage]?.[category] ?? 0;
}

/**
 * Builds the citation reasons for one recommended snippet,
 * ordered by priority: goal alignment, tag match, repo
 * convention, then usage history (or the cold-start baseline
 * when usage is untracked).
 */
export function buildCitations(
  snippet: Snippet,
  context: CitationContext
): CitationReason[] {
  const stage =
    context.stage ?? inferSessionStage({ latestMessage: context.latestMessage });
  const reasons: CitationReason[] = [];

  // 1. Goal alignment — the ingested COR-56 criteria.
  for (const criterion of context.goalCriteria ?? []) {
    if (matchesCriterion(snippet, criterion)) {
      reasons.push({
        kind: 'goal_alignment',
        text: `Aligns with the goal criterion "${criterion.trim()}".`,
      });
      break;
    }
  }

  // 2. Tag match — keywords shared with the latest Jules output,
  //    or the stage fit when the output shares no keywords.
  const keywords = matchedKeywords(snippet, context.latestMessage);
  if (keywords.length > 0) {
    reasons.push({
      kind: 'tag_match',
      text: `Matches keywords in the latest Jules output: ${keywords
        .slice(0, MAX_MATCHED_KEYWORDS)
        .map((keyword) => `"${keyword}"`)
        .join(', ')}.`,
    });
  } else if (stage !== 'unknown') {
    const affinity = stageAffinityFor(stage, snippet.category);
    if (affinity >= STAGE_FIT_THRESHOLD) {
      reasons.push({
        kind: 'tag_match',
        text: `Category "${snippet.category}" fits the current session stage (${describeSessionStage(stage)}).`,
      });
    }
  }

  // 3. Repo conventions — grounded in the saved profile, when present.
  const profile = context.repoProfile;
  if (profile) {
    for (const convention of profile.conventions) {
      if (matchesConvention(snippet, convention.title, convention.body)) {
        reasons.push({
          kind: 'repo_convention',
          text: `Grounded in the saved repository convention "${convention.title}".`,
        });
        break;
      }
    }
  }

  // 4. Usage history — or the cold-start baseline when untracked.
  const usageCount = context.usageCounts?.get(snippet.id) ?? snippet.usageCount ?? 0;
  if (usageCount > 0) {
    reasons.push({
      kind: 'usage_history',
      text: `Used ${usageCount} time${usageCount === 1 ? '' : 's'} in previous sessions.`,
    });
  } else {
    reasons.push({
      kind: 'cold_start',
      text: 'No prior usage — ranked by the cold-start scoring formula.',
    });
  }

  return reasons.slice(0, MAX_CITATION_REASONS);
}
