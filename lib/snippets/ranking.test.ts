import { describe, expect, it } from 'vitest';
import {
  MAX_SUGGESTIONS,
  MIN_SUGGESTION_SCORE,
  RELEVANCE_WEIGHT,
  TAG_MATCH_WEIGHT,
  TITLE_MATCH_WEIGHT,
  buildQueryTokens,
  computeRelevance,
  computeTagMatch,
  rankSnippets,
  scoreSnippet,
  tokenize,
  type RankingContext,
  type ScoredSnippet,
} from './ranking';
import { getBuiltinSnippets } from './builtin-loader';
import { parseSnippet, type Snippet } from '@/lib/types/steering';

const STAMP = '2026-09-01T12:00:00.000Z';

/** Hermetic fixture factory — no vault, no DOM, no network. */
function snippet(overrides: Partial<Snippet> = {}): Snippet {
  return parseSnippet({
    id: 'snippet-fixture',
    title: 'Run tests',
    content: 'Run the test suite for touched files.',
    category: 'verification',
    isBuiltin: false,
    isPinned: false,
    usageCount: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  });
}

describe('tokenize', () => {
  it('lowercases, drops stopwords and short tokens', () => {
    expect(tokenize('Run THE test Suite!')).toEqual(['run', 'test', 'suite']);
    expect(tokenize('a an to is')).toEqual([]);
    expect(tokenize('')).toEqual([]);
  });

  it('splits on non-alphanumeric characters', () => {
    expect(tokenize('file-boundary_checks')).toEqual([
      'file',
      'boundary',
      'checks',
    ]);
  });
});

describe('buildQueryTokens', () => {
  it('joins latest message and goal criteria without duplicates', () => {
    const tokens = buildQueryTokens({
      latestMessage: 'Run the tests',
      goalCriteria: ['Run the tests', 'Check the lint output'],
    });
    expect(tokens).toEqual(['run', 'tests', 'check', 'lint', 'output']);
  });

  it('is empty for a blank context', () => {
    expect(buildQueryTokens({ latestMessage: '' })).toEqual([]);
    expect(buildQueryTokens({ latestMessage: '  ' })).toEqual([]);
  });
});

describe('computeRelevance', () => {
  it('returns 0 for an empty query', () => {
    expect(computeRelevance([], snippet())).toBe(0);
  });

  it('scores a full title match at 1', () => {
    // One query token hitting the title: (1 * 2) / (1 * 2) = 1.
    expect(computeRelevance(['tests'], snippet())).toBe(1);
  });

  it('weights a title hit above a content hit', () => {
    // 'suite' only exists in the content: (0 * 2 + 1) / (1 * 2) = 0.5.
    expect(computeRelevance(['suite'], snippet())).toBe(0.5);
  });

  it('mixes title and content hits across a multi-token query', () => {
    // 'tests' hits the title, 'suite' hits the content, 'lint' misses:
    // (1 * 2 + 1) / (3 * 2) = 0.5.
    expect(computeRelevance(['tests', 'suite', 'lint'], snippet())).toBe(0.5);
  });

  it('never exceeds 1', () => {
    expect(computeRelevance(['run', 'tests'], snippet())).toBe(1);
  });

  it('expects a pre-tokenized query (stopwords removed upstream)', () => {
    // buildQueryTokens strips stopwords before relevance runs, so a
    // raw 'the' in the query array is simply a non-matching token.
    expect(computeRelevance(['the', 'tests'], snippet())).toBe(0.5);
    expect(
      computeRelevance(buildQueryTokens({ latestMessage: 'the tests' }), snippet())
    ).toBe(1);
  });
});

describe('computeTagMatch', () => {
  it('uses the stage affinity table', () => {
    expect(computeTagMatch('mid_execution', 'verification')).toBe(0.9);
    expect(computeTagMatch('mid_execution', 'remediation')).toBe(0.7);
    expect(computeTagMatch('mid_execution', 'investigation')).toBe(0.5);
    expect(computeTagMatch('mid_execution', 'general')).toBe(0.4);
  });

  it('is neutral for an unknown stage', () => {
    for (const category of [
      'investigation',
      'verification',
      'remediation',
      'general',
    ] as const) {
      expect(computeTagMatch('unknown', category)).toBe(0.5);
    }
  });

  it('differs by stage for the same category', () => {
    expect(computeTagMatch('plan_review', 'investigation')).toBe(0.9);
    expect(computeTagMatch('post_pr', 'investigation')).toBe(0.4);
  });
});

describe('scoreSnippet', () => {
  it('computes score = relevance * 0.6 + tagMatch * 0.4', () => {
    const context: RankingContext = {
      latestMessage: 'Run the tests',
      stage: 'mid_execution',
    };
    const scored = scoreSnippet(snippet(), context);
    // Query tokens: ['run', 'tests'] — both hit the title → relevance 1.
    expect(scored.relevance).toBe(1);
    expect(scored.tagMatch).toBe(0.9);
    expect(scored.score).toBeCloseTo(1 * RELEVANCE_WEIGHT + 0.9 * TAG_MATCH_WEIGHT, 12);
    expect(scored.score).toBeCloseTo(0.96, 12);
  });

  it('infers the stage from the message when none is given', () => {
    const scored = scoreSnippet(
      snippet({ category: 'verification' }),
      { latestMessage: 'Executing the test suite now' }
    );
    expect(scored.tagMatch).toBe(0.9);
  });

  it('a content-only match scores below a title match at the same tagMatch', () => {
    const titleHit = scoreSnippet(snippet(), { latestMessage: 'tests' });
    const contentHit = scoreSnippet(snippet(), { latestMessage: 'suite' });
    expect(titleHit.relevance).toBeGreaterThan(contentHit.relevance);
    expect(titleHit.score).toBeGreaterThan(contentHit.score);
  });
});

describe('rankSnippets', () => {
  it('returns an empty list for empty candidates', () => {
    expect(rankSnippets([], { latestMessage: 'run tests' })).toEqual([]);
  });

  it('returns nothing when no signal passes the threshold', () => {
    // Unknown stage + empty query → score 0.2 < MIN_SUGGESTION_SCORE.
    const results = rankSnippets(getBuiltinSnippets(), { latestMessage: '' });
    expect(results).toEqual([]);
  });

  it('returns nothing when the message matches no snippet', () => {
    const results = rankSnippets(getBuiltinSnippets(), {
      latestMessage: 'zzxq jwv kmgp',
    });
    expect(results).toEqual([]);
  });

  it('suggests stage-fitting categories even with an empty message', () => {
    // mid_execution: verification (0.36) and remediation (0.28) clear
    // the 0.25 threshold; investigation (0.2) and general (0.16) do not.
    const results = rankSnippets(getBuiltinSnippets(), {
      latestMessage: '',
      stage: 'mid_execution',
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    for (const { snippet: candidate } of results) {
      expect(['verification', 'remediation']).toContain(candidate.category);
    }
    // All verification snippets tie at 0.36 and outrank remediation.
    expect(results[0].score).toBeCloseTo(0.9 * TAG_MATCH_WEIGHT, 12);
  });

  it('ranks by score, then by id on ties', () => {
    const candidates = [
      snippet({ id: 'snippet-b', title: 'Run tests', content: 'x' }),
      snippet({ id: 'snippet-a', title: 'Run tests', content: 'x' }),
      snippet({ id: 'snippet-c', title: 'Run tests', content: 'x' }),
    ];
    const results = rankSnippets(candidates, {
      latestMessage: 'tests',
      stage: 'mid_execution',
    });
    expect(results.map((r) => r.snippet.id)).toEqual([
      'snippet-a',
      'snippet-b',
      'snippet-c',
    ]);
    // Identical fixtures → identical scores.
    expect(results[0].score).toBe(results[1].score);
    expect(results[1].score).toBe(results[2].score);
  });

  it('caps the result at the top five suggestions', () => {
    const candidates: Snippet[] = [];
    for (let i = 0; i < 8; i += 1) {
      candidates.push(
        snippet({
          id: `snippet-ranked-${String(i).padStart(2, '0')}`,
          title: 'Run tests',
          content: 'Run the test suite.',
        })
      );
    }
    const results = rankSnippets(candidates, {
      latestMessage: 'tests',
      stage: 'mid_execution',
    });
    expect(results).toHaveLength(MAX_SUGGESTIONS);
    expect(results.map((r) => r.snippet.id)).toEqual([
      'snippet-ranked-00',
      'snippet-ranked-01',
      'snippet-ranked-02',
      'snippet-ranked-03',
      'snippet-ranked-04',
    ]);
  });

  it('a higher relevance outranks a higher tagMatch when scores differ', () => {
    // Both verification (tagMatch 0.9 at mid_execution). The first
    // matches the query token in its title (relevance 1); the second
    // matches nothing (relevance 0).
    const strong = snippet({ id: 'snippet-strong', title: 'Run tests' });
    const weak = snippet({ id: 'snippet-weak', title: 'Unrelated topic' });
    const results = rankSnippets([weak, strong], {
      latestMessage: 'tests',
      stage: 'mid_execution',
    });
    expect(results[0].snippet.id).toBe('snippet-strong');
    expect(results[0].relevance).toBe(1);
    expect(results[1].relevance).toBe(0);
  });

  it('goal criteria contribute matching tokens', () => {
    // The message is empty; the goal criterion supplies 'tests'.
    const results = rankSnippets([snippet()], {
      latestMessage: '',
      goalCriteria: ['Run tests on the touched files'],
      stage: 'mid_execution',
    });
    expect(results).toHaveLength(1);
    expect(results[0].relevance).toBeGreaterThan(0);
  });

  it('is deterministic across repeated calls', () => {
    const context: RankingContext = {
      latestMessage: 'Running the security scan and the test suite',
      goalCriteria: ['Verify the dependency audit passes'],
    };
    const first = rankSnippets(getBuiltinSnippets(), context);
    for (let i = 0; i < 3; i += 1) {
      expect(rankSnippets(getBuiltinSnippets(), context)).toEqual(first);
    }
    expect(first.length).toBeGreaterThan(0);
  });

  it('scores every built-in within [0, 1]', () => {
    const scored: ScoredSnippet[] = rankSnippets(getBuiltinSnippets(), {
      latestMessage:
        'Explain the failing test suite and prepare the pull request',
    });
    for (const { score, relevance, tagMatch } of scored) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
      expect(relevance).toBeGreaterThanOrEqual(0);
      expect(relevance).toBeLessThanOrEqual(1);
      expect(tagMatch).toBeGreaterThanOrEqual(0);
      expect(tagMatch).toBeLessThanOrEqual(1);
    }
  });

  it('the threshold constant keeps the formula honest', () => {
    // A neutral tagMatch with zero relevance must stay below the
    // threshold so a signal-less context renders no suggestions.
    expect(0 * RELEVANCE_WEIGHT + 0.5 * TAG_MATCH_WEIGHT).toBeLessThan(
      MIN_SUGGESTION_SCORE
    );
    // The strongest cold-start signal must clear it.
    expect(1 * RELEVANCE_WEIGHT + 0.9 * TAG_MATCH_WEIGHT).toBeGreaterThan(
      MIN_SUGGESTION_SCORE
    );
  });

  it('title match weight is applied as documented', () => {
    // One title hit and one content hit over a two-token query:
    // (1 * TITLE_MATCH_WEIGHT + 1) / (2 * TITLE_MATCH_WEIGHT) = 0.75.
    expect(TITLE_MATCH_WEIGHT).toBe(2);
    expect(
      computeRelevance(['tests', 'suite'], snippet())
    ).toBeCloseTo(0.75, 12);
  });
});
