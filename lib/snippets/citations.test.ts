import { describe, expect, it } from 'vitest';
import {
  MAX_CITATION_REASONS,
  buildCitations,
  matchedKeywords,
  type CitationReason,
} from './citations';
import { MAX_MATCHED_KEYWORDS } from './ranking';
import { parseRepoProfile, parseSnippet, type RepoProfile, type Snippet } from '@/lib/types/steering';

const STAMP = '2026-09-01T12:00:00.000Z';

function snippet(overrides: Partial<Snippet> = {}): Snippet {
  return parseSnippet({
    id: 'snippet-fixture',
    title: 'Run relevant tests',
    content: 'Run the repository test suite scoped to touched files.',
    category: 'verification',
    isBuiltin: false,
    isPinned: false,
    usageCount: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  });
}

function profile(overrides: Partial<RepoProfile> = {}): RepoProfile {
  return parseRepoProfile({
    id: 'acme-corp/api-gateway',
    repoRef: { owner: 'acme-corp', repo: 'api-gateway' },
    stack: {
      packageManager: 'npm',
      testRunner: 'vitest',
      framework: 'next',
      languages: ['typescript'],
    },
    conventions: [
      {
        id: 'conv-tests',
        title: 'Run tests before merge',
        body: 'Every pull request runs the vitest suite for touched files.',
        source: 'CONTRIBUTING.md',
      },
      {
        id: 'conv-lint',
        title: 'Lint clean',
        body: 'Keep the eslint output clean on changed files.',
      },
    ],
    updatedAt: STAMP,
    version: 1,
    ...overrides,
  });
}

describe('matchedKeywords', () => {
  it('returns shared tokens between snippet and message', () => {
    const keywords = matchedKeywords(
      snippet(),
      'Running the test suite now'
    );
    expect(keywords).toEqual(['test', 'suite']);
  });

  it('deduplicates repeated tokens', () => {
    const keywords = matchedKeywords(snippet(), 'test test test');
    expect(keywords).toEqual(['test']);
  });

  it('is empty when nothing is shared', () => {
    expect(matchedKeywords(snippet(), 'zzxq jwv')).toEqual([]);
  });

  it('returns every shared token (the render path caps the list)', () => {
    const many = snippet({
      title: 'alpha beta gamma delta epsilon zeta',
      content: 'eta theta iota kappa lambda omega',
    });
    const keywords = matchedKeywords(
      many,
      'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda omega'
    );
    expect(keywords).toEqual([
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
      'zeta',
      'eta',
      'theta',
      'iota',
      'kappa',
      'lambda',
      'omega',
    ]);
  });

  it('caps the keywords listed in a citation', () => {
    const many = snippet({
      title: 'alpha beta gamma delta epsilon zeta',
      content: 'eta theta iota kappa lambda omega',
    });
    const reasons = buildCitations(many, {
      latestMessage:
        'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda omega',
      stage: 'unknown',
    });
    const tagMatch = reasons.find((r) => r.kind === 'tag_match');
    expect(tagMatch?.text).toContain('"alpha"');
    expect(tagMatch?.text).not.toContain('"omega"');
    // Exactly MAX_MATCHED_KEYWORDS quoted keywords.
    const quoted = tagMatch?.text.match(/"[a-z]+"/g) ?? [];
    expect(quoted).toHaveLength(MAX_MATCHED_KEYWORDS);
  });
});

describe('buildCitations', () => {
  it('cites matched keywords as a tag match', () => {
    const reasons = buildCitations(snippet(), {
      latestMessage: 'Running the test suite now',
      stage: 'mid_execution',
    });
    const tagMatch = reasons.find((r) => r.kind === 'tag_match');
    expect(tagMatch?.text).toContain('"test"');
    expect(tagMatch?.text).toContain('"suite"');
  });

  it('cites the stage fit when no keywords are shared', () => {
    // 'zzxq' shares nothing with the snippet; mid_execution
    // verification affinity (0.9) clears the 0.6 threshold.
    const reasons = buildCitations(snippet(), {
      latestMessage: 'zzxq jwv',
      stage: 'mid_execution',
    });
    const tagMatch = reasons.find((r) => r.kind === 'tag_match');
    expect(tagMatch?.text).toContain('verification');
    expect(tagMatch?.text).toContain('mid execution');
  });

  it('omits the tag-match reason for an unknown stage with no keywords', () => {
    const reasons = buildCitations(snippet(), {
      latestMessage: 'zzxq jwv',
      stage: 'unknown',
    });
    expect(reasons.find((r) => r.kind === 'tag_match')).toBeUndefined();
  });

  it('omits the stage fit below the affinity threshold', () => {
    // plan_review verification affinity is 0.4 < 0.6.
    const reasons = buildCitations(snippet(), {
      latestMessage: 'zzxq jwv',
      stage: 'plan_review',
    });
    expect(reasons.find((r) => r.kind === 'tag_match')).toBeUndefined();
  });

  it('cites goal alignment for a matching criterion', () => {
    const reasons = buildCitations(snippet(), {
      latestMessage: 'zzxq jwv',
      stage: 'unknown',
      goalCriteria: ['Run relevant tests on touched files'],
    });
    const alignment = reasons.find((r) => r.kind === 'goal_alignment');
    expect(alignment?.text).toContain('Run relevant tests on touched files');
  });

  it('cites the first matching criterion only', () => {
    const reasons = buildCitations(snippet(), {
      latestMessage: 'zzxq jwv',
      stage: 'unknown',
      goalCriteria: [
        'Run relevant tests on touched files',
        'Run the test suite again',
      ],
    });
    const alignments = reasons.filter((r) => r.kind === 'goal_alignment');
    expect(alignments).toHaveLength(1);
  });

  it('cites a repo convention when the profile is present', () => {
    const reasons = buildCitations(snippet(), {
      latestMessage: 'zzxq jwv',
      stage: 'unknown',
      repoProfile: profile(),
    });
    const convention = reasons.find((r) => r.kind === 'repo_convention');
    expect(convention?.text).toContain('Run tests before merge');
  });

  it('fails soft: no profile omits convention citations without error', () => {
    const reasons = buildCitations(snippet(), {
      latestMessage: 'zzxq jwv',
      stage: 'unknown',
      repoProfile: undefined,
    });
    expect(reasons.find((r) => r.kind === 'repo_convention')).toBeUndefined();
    // The other reasons are unaffected.
    expect(reasons.length).toBeGreaterThan(0);
  });

  it('cites usage history from the usage map', () => {
    const reasons = buildCitations(snippet(), {
      latestMessage: 'zzxq jwv',
      stage: 'unknown',
      usageCounts: new Map([['snippet-fixture', 3]]),
    });
    const usage = reasons.find((r) => r.kind === 'usage_history');
    expect(usage?.text).toContain('Used 3 times');
  });

  it('cites usage history from the snippet record', () => {
    const reasons = buildCitations(snippet({ usageCount: 1 }), {
      latestMessage: 'zzxq jwv',
      stage: 'unknown',
    });
    const usage = reasons.find((r) => r.kind === 'usage_history');
    expect(usage?.text).toContain('Used 1 time');
  });

  it('prefers the usage map over the snippet record', () => {
    const reasons = buildCitations(snippet({ usageCount: 1 }), {
      latestMessage: 'zzxq jwv',
      stage: 'unknown',
      usageCounts: new Map([['snippet-fixture', 7]]),
    });
    const usage = reasons.find((r) => r.kind === 'usage_history');
    expect(usage?.text).toContain('Used 7 times');
  });

  it('falls back to the cold-start baseline when usage is untracked', () => {
    const reasons = buildCitations(snippet(), {
      latestMessage: 'zzxq jwv',
      stage: 'unknown',
    });
    const coldStart = reasons.find((r) => r.kind === 'cold_start');
    expect(coldStart?.text).toContain('cold-start');
  });

  it('orders reasons by priority', () => {
    const reasons = buildCitations(snippet(), {
      latestMessage: 'Running the test suite now',
      stage: 'mid_execution',
      goalCriteria: ['Run relevant tests on touched files'],
      repoProfile: profile(),
      usageCounts: new Map([['snippet-fixture', 2]]),
    });
    const kinds = reasons.map((r) => r.kind);
    expect(kinds.indexOf('goal_alignment')).toBeLessThan(
      kinds.indexOf('tag_match')
    );
    expect(kinds.indexOf('tag_match')).toBeLessThan(
      kinds.indexOf('repo_convention')
    );
    expect(kinds.indexOf('repo_convention')).toBeLessThan(
      kinds.indexOf('usage_history')
    );
  });

  it('caps the reason list', () => {
    const reasons = buildCitations(snippet(), {
      latestMessage: 'Running the test suite now',
      stage: 'mid_execution',
      goalCriteria: ['Run relevant tests on touched files'],
      repoProfile: profile(),
      usageCounts: new Map([['snippet-fixture', 2]]),
    });
    expect(reasons.length).toBeLessThanOrEqual(MAX_CITATION_REASONS);
  });

  it('infers the stage from the message when omitted', () => {
    const reasons = buildCitations(snippet(), {
      latestMessage: 'Executing the test suite',
    });
    // Inferred mid_execution → verification affinity 0.9, but the
    // keyword match takes the tag-match slot first.
    const tagMatch = reasons.find((r) => r.kind === 'tag_match');
    expect(tagMatch?.text).toContain('"test"');
  });

  it('always ends with a usage or cold-start reason', () => {
    const withUsage = buildCitations(snippet(), {
      latestMessage: 'zzxq',
      stage: 'unknown',
      usageCounts: new Map([['snippet-fixture', 1]]),
    });
    expect(withUsage[withUsage.length - 1].kind).toBe('usage_history');

    const withoutUsage = buildCitations(snippet(), {
      latestMessage: 'zzxq',
      stage: 'unknown',
    });
    expect(withoutUsage[withoutUsage.length - 1].kind).toBe('cold_start');
  });

  it('produces plain-text reasons for every kind', () => {
    const reasons: CitationReason[] = buildCitations(snippet(), {
      latestMessage: 'Running the test suite now',
      stage: 'mid_execution',
      goalCriteria: ['Run relevant tests on touched files'],
      repoProfile: profile(),
      usageCounts: new Map([['snippet-fixture', 2]]),
    });
    for (const reason of reasons) {
      expect(typeof reason.text).toBe('string');
      expect(reason.text.length).toBeGreaterThan(0);
    }
  });
});
