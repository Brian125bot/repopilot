import { inferSessionStage, type SessionStage } from './state';
import type { Snippet, SnippetCategory } from '@/lib/types/steering';

/**
 * COR-59 cold-start suggestion and ranking engine.
 *
 * Pure and deterministic: the same candidates and context always
 * produce the same ranked list. No clock, no randomness, no I/O —
 * every constant is named and exported so the formula is testable
 * rather than magic.
 *
 * Cold-start score:
 *
 *     score = (relevance * 0.6) + (tagMatch * 0.4)
 *
 * `relevance` is text overlap between the query corpus (latest Jules
 * output plus ingested goal criteria) and the snippet, with title
 * hits weighted above content hits. `tagMatch` is the category's
 * affinity for the inferred session stage — the cold-start prior for
 * what an operator wants to say at each point in a Jules turn.
 */

/** Weight of text relevance in the cold-start score. */
export const RELEVANCE_WEIGHT = 0.6;
/** Weight of stage/category tag affinity in the cold-start score. */
export const TAG_MATCH_WEIGHT = 0.4;
/** A title keyword hit is worth this many content hits. */
export const TITLE_MATCH_WEIGHT = 2;
/** Minimum score a snippet needs to be suggested at all. */
export const MIN_SUGGESTION_SCORE = 0.25;
/** Maximum number of suggestions the snippet bar renders. */
export const MAX_SUGGESTIONS = 5;
/** Tokens shorter than this carry no matching signal. */
const MIN_TOKEN_LENGTH = 3;
/** Most keywords a single citation lists. */
export const MAX_MATCHED_KEYWORDS = 4;

/** Common English words dropped before matching. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'these', 'those',
  'have', 'has', 'had', 'was', 'were', 'are', 'been', 'being', 'will',
  'would', 'could', 'should', 'shall', 'may', 'might', 'must', 'can',
  'not', 'but', 'all', 'any', 'each', 'every', 'some', 'such', 'only',
  'same', 'too', 'very', 'just', 'also', 'into', 'over', 'under', 'after',
  'before', 'between', 'about', 'against', 'during', 'until', 'while',
  'because', 'through', 'both', 'few', 'more', 'most', 'other', 'then',
  'than', 'when', 'what', 'which', 'who', 'whom', 'whose', 'where',
  'why', 'how', 'their', 'there', 'here', 'they', 'them', 'its', 'our',
  'ours', 'yours', 'theirs', 'you', 'your', 'his', 'her', 'him', 'she',
  'he', 'we', 'us', 'out', 'off', 'up', 'down', 'did', 'does', 'done',
  'get', 'got', 'make', 'made', 'way', 'use', 'used', 'using',
]);

/**
 * How well a snippet category fits each session stage — the
 * cold-start prior. `unknown` is deliberately neutral so an
 * unrecognized session never distorts the ranking.
 */
export const STAGE_CATEGORY_AFFINITY: Readonly<
  Record<SessionStage, Readonly<Record<SnippetCategory, number>>>
> = Object.freeze({
  plan_review: Object.freeze({
    investigation: 0.9,
    general: 0.7,
    verification: 0.4,
    remediation: 0.3,
  }),
  mid_execution: Object.freeze({
    verification: 0.9,
    remediation: 0.7,
    investigation: 0.5,
    general: 0.4,
  }),
  pre_pr: Object.freeze({
    remediation: 0.8,
    verification: 0.7,
    general: 0.6,
    investigation: 0.4,
  }),
  post_pr: Object.freeze({
    general: 0.9,
    verification: 0.6,
    investigation: 0.4,
    remediation: 0.3,
  }),
  unknown: Object.freeze({
    investigation: 0.5,
    verification: 0.5,
    remediation: 0.5,
    general: 0.5,
  }),
});

export interface RankingContext {
  /** Latest Jules message text (the operator's prompt context). */
  latestMessage: string;
  /** Goal criteria captured by COR-56 goal ingestion, when present. */
  goalCriteria?: readonly string[];
  /** Pre-inferred session stage; inferred from latestMessage when omitted. */
  stage?: SessionStage;
}

export interface ScoredSnippet {
  snippet: Snippet;
  /** Final cold-start score in [0, 1]. */
  score: number;
  /** Text relevance component in [0, 1]. */
  relevance: number;
  /** Stage/category tag affinity component in [0, 1]. */
  tagMatch: number;
}

const TOKEN_PATTERN = /[a-z0-9]+/g;

/** Lowercase alphanumeric tokens, minus stopwords and short noise. */
export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(TOKEN_PATTERN) ?? [];
  const tokens: string[] = [];
  for (const token of matches) {
    if (token.length < MIN_TOKEN_LENGTH || STOPWORDS.has(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

function uniqueTokens(text: string): Set<string> {
  return new Set(tokenize(text));
}

/** Query corpus: latest Jules output plus any goal criteria. */
export function buildQueryTokens(context: RankingContext): string[] {
  const parts = [context.latestMessage, ...(context.goalCriteria ?? [])];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of parts) {
    for (const token of tokenize(part)) {
      if (seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

/**
 * Text relevance in [0, 1]: the share of query tokens the snippet
 * covers, with a title hit worth TITLE_MATCH_WEIGHT content hits.
 * An empty query yields zero relevance — no text, no signal.
 */
export function computeRelevance(
  query: readonly string[],
  snippet: Snippet
): number {
  if (query.length === 0) return 0;
  const titleTokens = uniqueTokens(snippet.title);
  const contentTokens = uniqueTokens(snippet.content);
  let titleHits = 0;
  let contentHits = 0;
  for (const token of query) {
    if (titleTokens.has(token)) titleHits += 1;
    else if (contentTokens.has(token)) contentHits += 1;
  }
  const weighted = titleHits * TITLE_MATCH_WEIGHT + contentHits;
  return Math.min(1, weighted / (query.length * TITLE_MATCH_WEIGHT));
}

/** Stage/category affinity in [0, 1]. */
export function computeTagMatch(
  stage: SessionStage,
  category: SnippetCategory
): number {
  return STAGE_CATEGORY_AFFINITY[stage][category];
}

/**
 * Scores one snippet against the turn context. Exported so the
 * formula is unit-testable without a candidate list.
 */
export function scoreSnippet(
  snippet: Snippet,
  context: RankingContext
): ScoredSnippet {
  const stage =
    context.stage ?? inferSessionStage({ latestMessage: context.latestMessage });
  const query = buildQueryTokens(context);
  const relevance = computeRelevance(query, snippet);
  const tagMatch = computeTagMatch(stage, snippet.category);
  const score = relevance * RELEVANCE_WEIGHT + tagMatch * TAG_MATCH_WEIGHT;
  return { snippet, score, relevance, tagMatch };
}

/** Deterministic ordering: score desc, then snippet id asc. */
function compareScored(a: ScoredSnippet, b: ScoredSnippet): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.snippet.id !== b.snippet.id) return a.snippet.id < b.snippet.id ? -1 : 1;
  return 0;
}

/**
 * Ranks candidate snippets (built-ins plus decrypted vault customs)
 * for the current turn and returns at most MAX_SUGGESTIONS that clear
 * MIN_SUGGESTION_SCORE. Empty candidates, or a context with no
 * signal at all, yield an empty list — the snippet bar then renders
 * nothing and only the freeform input box is shown.
 */
export function rankSnippets(
  candidates: readonly Snippet[],
  context: RankingContext
): ScoredSnippet[] {
  if (candidates.length === 0) return [];
  return candidates
    .map((snippet) => scoreSnippet(snippet, context))
    .filter((scored) => scored.score >= MIN_SUGGESTION_SCORE)
    .sort(compareScored)
    .slice(0, MAX_SUGGESTIONS);
}
