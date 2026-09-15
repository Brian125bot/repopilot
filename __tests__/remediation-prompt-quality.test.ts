import { describe, it, expect } from 'vitest';
import { Blueprint, CriterionResult, GeminiAuditReport } from '@/types';
import { compileRemediationPrompt } from '@/lib/prompt-compiler';
import {
  MAX_CONTINUATION_CHARS,
  MAX_REQUIRED_FIXES,
  buildFailureBrief,
  compileContinuationPrompt,
} from '@/lib/outcome-memory';

/**
 * Quality + performance suite for the shipped first-pass remediation compiler
 * (`compileRemediationPrompt`) and the continuation compiler
 * (`buildFailureBrief` + `compileContinuationPrompt`).
 *
 * Hard asserts cover invariants that must not regress (missed-task facts,
 * branch lock, banned payload, size caps). Characterization tests document
 * what the shipped compilers currently omit so a later compiler change is
 * an explicit contract update rather than a silent drift.
 */

const BANNED_PAYLOAD = [
  'AUTO_CREATE_PR',
  'startingBranch',
  '```diff',
  'aistudio-build',
] as const;

const EVIDENCE_SNIPPET_CHARS = 240;
const FIX_LINE_CHARS = 350;
const TYPICAL_COMPILE_BUDGET_MS = 50;
const HUGE_COMPILE_BUDGET_MS = 100;
const BATCH_COMPILE_BUDGET_MS = 1500;

const blueprint: Blueprint = {
  blueprintId: 'bp_quality_1',
  repo: 'acme-corp/api-gateway',
  baseBranch: 'main',
  branchName: 'jules/rate-limiter-redis',
  fileBoundaries: ['src/middleware/**', 'tests/middleware/**'],
  objective: 'Implement an IP-based sliding window rate limiter backed by Redis.',
  criteria: [],
  createdAt: new Date().toISOString(),
  sessionId: 'sessions/session_quality',
  sessionUrl: 'https://jules.google.com/session/session_quality',
  sessionState: 'COMPLETED',
  prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
  auditedHeadSha: 'abc123',
};

function criterion(overrides: Partial<CriterionResult> & Pick<CriterionResult, 'id' | 'status'>): CriterionResult {
  return {
    criterion: `Criterion text ${overrides.id}`,
    evidence: `Evidence for ${overrides.id}`,
    lineReferences: [],
    ...overrides,
  };
}

function buildReport(overrides?: Partial<GeminiAuditReport>): GeminiAuditReport {
  return {
    criteriaResults: [
      criterion({
        id: '1',
        criterion: 'Middleware extracts client IP',
        status: 'MET',
        evidence: 'IP extracted via x-forwarded-for',
        lineReferences: ['src/middleware/rate-limiter.ts:18-24'],
      }),
      criterion({
        id: '2',
        criterion: 'Sliding window enforces 60 req/min',
        status: 'UNMET',
        evidence: 'No TTL fallback in window calculation',
        lineReferences: ['src/middleware/rate-limiter.ts:45-52'],
      }),
      criterion({
        id: '3',
        criterion: 'Unit tests cover burst traffic',
        status: 'PARTIALLY_MET',
        evidence: 'Happy-path test exists; burst case is skipped',
        lineReferences: ['tests/middleware/rate-limiter.test.ts:80-94'],
      }),
    ],
    scopeIntegrity: {
      strictlyInScope: false,
      unauthorizedFiles: ['package.json'],
      explanation: 'Dependency freeze violated.',
    },
    blastRadius: { rating: 'MEDIUM', explanation: 'Root manifest touched.' },
    mergeVerdict: {
      status: 'NEEDS_REVISION',
      overallScore: 62,
      keyBlockers: ['TTL fallback missing', 'Unauthorized package.json change'],
      actionableFeedbackForAgent: 'Revert package.json and add TTL fallback.',
    },
    ...overrides,
  };
}

function firstPass(report: GeminiAuditReport = buildReport(), extra?: { fileBoundaries?: string[] }) {
  return compileRemediationPrompt({
    targetBranch: blueprint.branchName,
    baseBranch: blueprint.baseBranch,
    prNumber: 42,
    prUrl: blueprint.prUrl,
    report,
    fileBoundaries: extra?.fileBoundaries ?? blueprint.fileBoundaries,
  });
}

function continuation(report: GeminiAuditReport = buildReport(), unauthorized: string[] = []) {
  const brief = buildFailureBrief(report, blueprint, unauthorized);
  return { brief, prompt: compileContinuationPrompt({ blueprint, brief }) };
}

function continuationBodyLength(prompt: string): number {
  const [header, ...rest] = prompt.split('\n');
  expect(header).toContain(blueprint.blueprintId);
  return rest.join('\n').length;
}

function assertNoBannedPayload(prompt: string) {
  for (const token of BANNED_PAYLOAD) {
    expect(prompt).not.toContain(token);
  }
  expect(prompt).not.toMatch(/^@@ -\d+/m);
}

function elapsedMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function hugeReport(openCount: number, evidenceChars: number): GeminiAuditReport {
  const criteriaResults: CriterionResult[] = [
    criterion({
      id: 'met-keep',
      criterion: 'Keep this MET work sealed',
      status: 'MET',
      evidence: 'Already correct in src/middleware/rate-limiter.ts',
      lineReferences: ['src/middleware/rate-limiter.ts:1-10'],
    }),
  ];
  for (let i = 0; i < openCount; i += 1) {
    const status = i % 3 === 0 ? 'PARTIALLY_MET' : 'UNMET';
    criteriaResults.push(
      criterion({
        id: `open-${i + 1}`,
        criterion: `Open task ${i + 1} ${'c'.repeat(80)}`,
        status,
        evidence: `${'e'.repeat(evidenceChars)} unique-${i + 1}`,
        lineReferences: [`src/middleware/file-${i + 1}.ts:${i + 10}-${i + 20}`],
      })
    );
  }
  return buildReport({
    criteriaResults,
    scopeIntegrity: {
      strictlyInScope: false,
      unauthorizedFiles: Array.from({ length: 40 }, (_, i) => `unauthorized/file-${i}.json`),
      explanation: 'Many out-of-scope files.',
    },
    mergeVerdict: {
      status: 'NEEDS_REVISION',
      overallScore: 40,
      keyBlockers: Array.from({ length: 12 }, (_, i) => `Blocker ${i + 1}: ${'b'.repeat(60)}`),
      actionableFeedbackForAgent: `Do the ${openCount} open tasks. ${'a'.repeat(400)}`,
    },
  });
}

interface QualityScore {
  branchLock: boolean;
  missedTaskIds: boolean;
  evidencePresent: boolean;
  unauthorizedRevert: boolean;
  noBannedPayload: boolean;
  objectiveRestated: boolean;
  metSealed: boolean;
  rankedUnmetBeforePartial: boolean;
}

function scorePrompt(prompt: string, report: GeminiAuditReport): QualityScore {
  const open = report.criteriaResults.filter((c) => c.status !== 'MET');
  const unmet = open.filter((c) => c.status === 'UNMET');
  const partial = open.filter((c) => c.status === 'PARTIALLY_MET');
  const met = report.criteriaResults.filter((c) => c.status === 'MET');
  const unauthorized = report.scopeIntegrity.unauthorizedFiles || [];

  const missedTaskIds = open.every(
    (c) => prompt.includes(`[${c.status}]`) && (prompt.includes(`Criterion ${c.id}`) || prompt.includes(`\`${c.id}\``))
  );
  const evidencePresent = open.every((c) => {
    const snippet = c.evidence.slice(0, 40);
    return snippet.length === 0 || prompt.includes(snippet);
  });

  const unmetIdx = unmet.length > 0 ? prompt.indexOf(`[UNMET] Criterion ${unmet[0].id}`) : -1;
  const partialIdx = partial.length > 0 ? prompt.indexOf(`[PARTIALLY_MET] Criterion ${partial[0].id}`) : -1;

  return {
    branchLock:
      (prompt.includes(`\`${blueprint.branchName}\``) && prompt.includes('DO NOT create an alternate branch')) ||
      (prompt.includes(`Work ONLY on branch \`${blueprint.branchName}\``) &&
        prompt.includes('Do not create a new branch')),
    missedTaskIds,
    evidencePresent,
    unauthorizedRevert: unauthorized.every((p) => prompt.includes(p)),
    noBannedPayload: BANNED_PAYLOAD.every((token) => !prompt.includes(token)) && !/^@@ -\d+/m.test(prompt),
    objectiveRestated: prompt.includes(blueprint.objective),
    metSealed: met.length === 0 || met.every((c) => prompt.includes(`\`${c.id}\``) && /do not reopen/i.test(prompt)),
    rankedUnmetBeforePartial: unmetIdx === -1 || partialIdx === -1 || unmetIdx < partialIdx,
  };
}

describe('quality: compileRemediationPrompt (first-pass)', () => {
  it('embeds every UNMET and PARTIAL id, criterion text, and evidence', () => {
    const prompt = firstPass();

    expect(prompt).toContain('[UNMET] Criterion 2: Sliding window enforces 60 req/min');
    expect(prompt).toContain('Evidence: No TTL fallback in window calculation');
    expect(prompt).toContain('[PARTIALLY_MET] Criterion 3: Unit tests cover burst traffic');
    expect(prompt).toContain('Evidence: Happy-path test exists; burst case is skipped');
  });

  it('omits MET criteria from the open-task list', () => {
    const prompt = firstPass();
    const openSection = prompt.slice(prompt.indexOf('Unmet / Partially Met Acceptance Criteria:'));

    expect(openSection).not.toContain('[MET]');
    expect(openSection).not.toContain('Middleware extracts client IP');
    expect(openSection).not.toContain('Criterion 1:');
  });

  it('locks the audited branch and forbids starting over from base', () => {
    const prompt = firstPass();

    expect(prompt).toContain('CRITICAL BRANCH WORKFLOW DIRECTIVE');
    expect(prompt).toContain('`jules/rate-limiter-redis`');
    expect(prompt).toContain('DO NOT create an alternate branch or start over from the base branch (main)');
    expect(prompt).toContain(blueprint.prUrl);
    expect(prompt).toContain('active Pull Request #42');
  });

  it('lists unauthorized files and key blockers as revert/block facts, not as new scope', () => {
    const prompt = firstPass();

    expect(prompt).toContain('**Unauthorized Files to Revert:** package.json');
    expect(prompt).toContain('VIOLATED');
    expect(prompt).toContain('1. TTL fallback missing');
    expect(prompt).toContain('2. Unauthorized package.json change');
    expect(prompt).toContain('Revert package.json and add TTL fallback.');
  });

  it('repeats authorized file boundaries when provided', () => {
    const prompt = firstPass();

    expect(prompt).toContain('Authorized File Boundaries:');
    expect(prompt).toContain('`src/middleware/**`');
    expect(prompt).toContain('`tests/middleware/**`');
  });

  it('never embeds banned payload (AUTO_CREATE_PR, diffs, startingBranch)', () => {
    assertNoBannedPayload(firstPass());
  });

  it('treats an all-MET report as no open criteria', () => {
    const prompt = firstPass(
      buildReport({
        criteriaResults: [
          criterion({
            id: '1',
            criterion: 'Middleware extracts client IP',
            status: 'MET',
            evidence: 'Done',
          }),
        ],
        mergeVerdict: {
          status: 'READY_TO_MERGE',
          overallScore: 100,
          keyBlockers: [],
          actionableFeedbackForAgent: 'None',
        },
        scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Clean.' },
      })
    );

    expect(prompt).toContain('All declared criteria were satisfied.');
    expect(prompt).not.toContain('[UNMET]');
    expect(prompt).not.toContain('[PARTIALLY_MET]');
  });

  it('meets the shipped first-pass quality bar (scorecard)', () => {
    const report = buildReport();
    const flags = scorePrompt(firstPass(report), report);

    expect(flags.branchLock).toBe(true);
    expect(flags.missedTaskIds).toBe(true);
    expect(flags.evidencePresent).toBe(true);
    expect(flags.unauthorizedRevert).toBe(true);
    expect(flags.noBannedPayload).toBe(true);
  });
});

describe('quality: buildFailureBrief', () => {
  it('orders requiredFixes UNMET then PARTIAL, each with id, status, criterion, remaining work', () => {
    const report = buildReport({
      criteriaResults: [
        criterion({
          id: 'p',
          criterion: 'Partial first in the report',
          status: 'PARTIALLY_MET',
          evidence: 'Still missing the burst case',
          satisfiedAspects: 'Happy path done',
          remainingWork: 'Add burst case',
        }),
        criterion({
          id: 'u',
          criterion: 'Unmet second in the report',
          status: 'UNMET',
          evidence: 'TTL fallback absent',
          remainingWork: 'Add TTL fallback',
        }),
        criterion({
          id: 'm',
          criterion: 'Already good',
          status: 'MET',
          evidence: 'Keep this',
          satisfiedAspects: 'Fully in place',
          lineReferences: ['src/keep.ts:1'],
        }),
      ],
    });
    const brief = buildFailureBrief(report, blueprint, []);

    expect(brief.unmetIds).toEqual(['u']);
    expect(brief.partialIds).toEqual(['p']);
    expect(brief.metIds).toEqual(['m']);
    expect(brief.requiredFixes).toHaveLength(2);
    expect(brief.requiredFixes[0]).toMatch(
      /^\[UNMET\] Criterion u: Unmet second in the report — Remaining: Add TTL fallback$/
    );
    expect(brief.requiredFixes[1]).toMatch(
      /^\[PARTIALLY_MET\] Criterion p: Partial first in the report — Satisfied: Happy path done → Remaining: Add burst case$/
    );
    // evidenceById prefers what-holds for PARTIAL/MET, gap for UNMET.
    expect(brief.evidenceById?.['p']).toContain('Happy path done');
    expect(brief.evidenceById?.['u']).toContain('Add TTL fallback');
  });

  it('flattens newlines and caps remaining-work snippets at 240 chars', () => {
    const longEvidence = `line one\nline two\n${'z'.repeat(400)}`;
    const brief = buildFailureBrief(
      buildReport({
        criteriaResults: [
          criterion({
            id: '2',
            criterion: 'Sliding window enforces 60 req/min',
            status: 'UNMET',
            evidence: longEvidence,
          }),
        ],
      }),
      blueprint,
      []
    );

    expect(brief.requiredFixes[0]).not.toMatch(/\n/);
    expect(brief.requiredFixes[0]).toContain('line one line two');
    const remainingPart = brief.requiredFixes[0].split(' — Remaining: ')[1];
    expect(remainingPart.length).toBeLessThanOrEqual(EVIDENCE_SNIPPET_CHARS);
    expect(brief.evidenceById?.['2']?.length).toBeLessThanOrEqual(EVIDENCE_SNIPPET_CHARS);
  });

  it('caps requiredFixes at MAX_REQUIRED_FIXES and spends the cap on UNMET first', () => {
    expect(MAX_REQUIRED_FIXES).toBe(7);
    const criteriaResults = [
      ...Array.from({ length: 5 }, (_, i) =>
        criterion({ id: `p${i + 1}`, criterion: `Partial ${i + 1}`, status: 'PARTIALLY_MET', evidence: 'gap' })
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        criterion({ id: `u${i + 1}`, criterion: `Unmet ${i + 1}`, status: 'UNMET', evidence: 'missing' })
      ),
    ];
    const brief = buildFailureBrief(buildReport({ criteriaResults }), blueprint, []);

    expect(brief.requiredFixes).toHaveLength(7);
    expect(brief.unmetIds).toHaveLength(8);
    expect(brief.partialIds).toHaveLength(5);
    expect(brief.requiredFixes.every((fix) => fix.startsWith('[UNMET]'))).toBe(true);
    expect(brief.requiredFixes.some((fix) => fix.includes('Partial'))).toBe(false);
  });

  it('puts MET-cited paths in doNotTouch but not in unauthorizedPaths', () => {
    const brief = buildFailureBrief(buildReport(), blueprint, ['tsconfig.json']);

    expect(brief.unauthorizedPaths).toEqual(expect.arrayContaining(['package.json', 'tsconfig.json']));
    expect(brief.unauthorizedPaths).not.toContain('src/middleware/rate-limiter.ts');
    expect(brief.doNotTouch).toContain('src/middleware/rate-limiter.ts');
    expect(brief.doNotTouch).not.toContain('tests/middleware/rate-limiter.test.ts');
    expect(brief.doNotTouch).not.toContain('x-forwarded-for');
  });
});

describe('quality: compileContinuationPrompt', () => {
  it('restates objective, boundaries, MET seal, ranked fixes, and branch/PR lock', () => {
    const { prompt } = continuation(buildReport(), ['package.json']);

    expect(prompt).toContain('<!-- CONTINUATION_CONTRACT: bp_quality_1 -->');
    expect(prompt).toContain(blueprint.objective);
    expect(prompt).toContain('`src/middleware/**`');
    expect(prompt).toContain('`tests/middleware/**`');
    expect(prompt).toContain('`1`: verified MET — do not reopen, modify, or re-verify.');
    expect(prompt).toContain('1. [UNMET] Criterion 2');
    expect(prompt).toContain('2. [PARTIALLY_MET] Criterion 3');
    expect(prompt).toContain('No TTL fallback in window calculation');
    expect(prompt).toContain('Happy-path test exists; burst case is skipped');
    expect(prompt).toContain('Work ONLY on branch `jules/rate-limiter-redis`');
    expect(prompt).toContain(blueprint.prUrl);
    expect(prompt).toContain('Do not create a new branch and do not open a new pull request.');
  });

  it('lists unauthorized paths as revert-only and never as a numbered feature task', () => {
    const { prompt } = continuation(buildReport(), ['package.json']);
    const revert = prompt.slice(prompt.indexOf('## 4. Revert only'), prompt.indexOf('## 5. Required fixes'));
    const fixes = prompt.slice(prompt.indexOf('## 5. Required fixes'));

    expect(revert).toContain('`package.json`: revert to base. No feature work here.');
    expect(fixes).not.toContain('package.json');
    expect(revert).not.toContain('src/middleware/rate-limiter.ts');
  });

  it('does not reopen MET work when the brief has zero open fixes', () => {
    const report = buildReport({
      criteriaResults: [
        criterion({
          id: '1',
          criterion: 'Middleware extracts client IP',
          status: 'MET',
          evidence: 'Done',
        }),
      ],
      scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Clean.' },
      mergeVerdict: {
        status: 'READY_TO_MERGE',
        overallScore: 100,
        keyBlockers: [],
        actionableFeedbackForAgent: 'None',
      },
    });
    const { prompt } = continuation(report);

    expect(prompt).toContain('Do not start new work');
    expect(prompt).toContain('do not reopen the MET criteria');
    expect(prompt).not.toMatch(/\n1\. /);
  });

  it('never embeds banned payload', () => {
    assertNoBannedPayload(continuation(buildReport(), ['package.json']).prompt);
  });

  it('meets the shipped continuation quality bar (scorecard)', () => {
    const report = buildReport();
    const flags = scorePrompt(continuation(report, ['package.json']).prompt, report);

    expect(flags.branchLock).toBe(true);
    expect(flags.missedTaskIds).toBe(true);
    expect(flags.evidencePresent).toBe(true);
    expect(flags.unauthorizedRevert).toBe(true);
    expect(flags.noBannedPayload).toBe(true);
    expect(flags.objectiveRestated).toBe(true);
    expect(flags.metSealed).toBe(true);
    expect(flags.rankedUnmetBeforePartial).toBe(true);
  });
});

describe('shipped-contract inventory (characterization)', () => {
  it('first-pass currently omits lineReferences, objective, and MET seals', () => {
    const report = buildReport();
    const prompt = firstPass(report);
    const flags = scorePrompt(prompt, report);

    expect(prompt).not.toContain('src/middleware/rate-limiter.ts:45-52');
    expect(prompt).not.toContain('tests/middleware/rate-limiter.test.ts:80-94');
    expect(flags.objectiveRestated).toBe(false);
    expect(flags.metSealed).toBe(false);
  });

  it('first-pass now ranks UNMET before PARTIAL (decision order)', () => {
    const report = buildReport({
      criteriaResults: [
        criterion({ id: '3', criterion: 'Partial first', status: 'PARTIALLY_MET', evidence: 'gap' }),
        criterion({ id: '2', criterion: 'Unmet second', status: 'UNMET', evidence: 'missing' }),
      ],
    });
    const prompt = firstPass(report);
    const flags = scorePrompt(prompt, report);

    expect(flags.rankedUnmetBeforePartial).toBe(true);
    expect(prompt.indexOf('[UNMET] Criterion 2')).toBeLessThan(prompt.indexOf('[PARTIALLY_MET] Criterion 3'));
  });

  it('continuation currently omits lineReferences and does not print doNotTouch MET paths as reverts', () => {
    const { brief, prompt } = continuation(buildReport(), ['package.json']);

    expect(brief.doNotTouch).toContain('src/middleware/rate-limiter.ts');
    expect(prompt).not.toContain('src/middleware/rate-limiter.ts:18-24');
    expect(prompt).not.toContain('src/middleware/rate-limiter.ts:45-52');
    const revert = prompt.slice(prompt.indexOf('## 4. Revert only'), prompt.indexOf('## 5. Required fixes'));
    expect(revert).not.toContain('src/middleware/rate-limiter.ts');
  });
});

describe('performance: caps, bounded output, latency', () => {
  it('exports the continuation size budget used by the compiler', () => {
    expect(MAX_CONTINUATION_CHARS).toBe(4000);
    expect(MAX_REQUIRED_FIXES).toBe(7);
  });

  it('keeps continuation body near 4000 chars even when evidence and open tasks explode', () => {
    const report = hugeReport(40, 800);
    const { brief, prompt } = continuation(report, report.scopeIntegrity.unauthorizedFiles);

    expect(brief.requiredFixes).toHaveLength(MAX_REQUIRED_FIXES);
    expect(continuationBodyLength(prompt)).toBeLessThanOrEqual(4100);
    expect(prompt.length).toBeLessThan(MAX_CONTINUATION_CHARS + 200);
    const numbered = prompt.match(/^\d+\. /gm) || [];
    expect(numbered.length).toBeLessThanOrEqual(MAX_REQUIRED_FIXES);
  });

  it('truncates each numbered continuation fix to the 350-char line budget', () => {
    const report = buildReport({
      criteriaResults: [
        criterion({
          id: '2',
          criterion: `Very long criterion ${'x'.repeat(400)}`,
          status: 'UNMET',
          evidence: `Very long evidence ${'y'.repeat(500)}`,
        }),
      ],
    });
    const { prompt } = continuation(report);
    const fixLine = prompt
      .split('\n')
      .find((line) => line.startsWith('1. '));

    expect(fixLine).toBeDefined();
    expect(fixLine!.slice(3).length).toBeLessThanOrEqual(FIX_LINE_CHARS);
  });

  it('continuation output stays bounded while first-pass grows with open-task volume', () => {
    const small = hugeReport(3, 80);
    const large = hugeReport(30, 800);
    const smallFirst = firstPass(small);
    const largeFirst = firstPass(large);
    const smallCont = continuation(small, small.scopeIntegrity.unauthorizedFiles).prompt;
    const largeCont = continuation(large, large.scopeIntegrity.unauthorizedFiles).prompt;

    expect(largeFirst.length).toBeGreaterThan(smallFirst.length);
    expect(continuationBodyLength(largeCont)).toBeLessThanOrEqual(4100);
    expect(Math.abs(largeCont.length - smallCont.length)).toBeLessThan(1200);
  });

  it('compiles a typical report well under the latency budget', () => {
    const report = buildReport();
    const firstMs = elapsedMs(() => {
      firstPass(report);
    });
    const contMs = elapsedMs(() => {
      continuation(report, ['package.json']);
    });

    expect(firstMs).toBeLessThan(TYPICAL_COMPILE_BUDGET_MS);
    expect(contMs).toBeLessThan(TYPICAL_COMPILE_BUDGET_MS);
  });

  it('compiles a huge report without hanging and still carries the first missed-task ids', () => {
    const report = hugeReport(80, 2000);
    let first = '';
    let prompt = '';
    const ms = elapsedMs(() => {
      first = firstPass(report);
      prompt = continuation(report, report.scopeIntegrity.unauthorizedFiles).prompt;
    });

    expect(ms).toBeLessThan(HUGE_COMPILE_BUDGET_MS);
    expect(first).toContain('[UNMET] Criterion open-2');
    expect(prompt).toContain('Criterion open-2');
    expect(continuationBodyLength(prompt)).toBeLessThanOrEqual(4100);
    assertNoBannedPayload(first);
    assertNoBannedPayload(prompt);
  });

  it('stays fast across a batch of typical compiles', () => {
    const report = buildReport();
    const ms = elapsedMs(() => {
      for (let i = 0; i < 400; i += 1) {
        firstPass(report);
        continuation(report, ['package.json']);
      }
    });

    expect(ms).toBeLessThan(BATCH_COMPILE_BUDGET_MS);
  });
});
