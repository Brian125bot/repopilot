import { describe, it, expect } from 'vitest';
import { buildFailureBrief } from '@/lib/outcome-memory';
import { attachAuditGrade } from '@/lib/scoring';

const blueprint = {
  blueprintId: 'bp_o_1', repo: 'a/b', baseBranch: 'main', branchName: 'jules/x',
  fileBoundaries: ['src/**'], objective: 'Implement x in src/a.ts verified by test',
  criteria: [], createdAt: new Date().toISOString(),
} as never;

function report() {
  return {
    criteriaResults: [
      { id: '1', criterion: 'MET work', status: 'MET' as const, evidence: 'done', satisfiedAspects: 'Sealed impl', lineReferences: ['src/a.ts:1-5'] },
      { id: '2', criterion: 'Missing work', status: 'UNMET' as const, evidence: 'absent', remainingWork: 'Add handler in src/a.ts', lineReferences: [] },
      { id: '3', criterion: 'Half work', status: 'PARTIALLY_MET' as const, evidence: 'half', satisfiedAspects: 'Happy path', remainingWork: 'Add edge case', lineReferences: [] },
    ],
    scopeIntegrity: { strictlyInScope: false, unauthorizedFiles: ['package.json'], explanation: 'drift' },
    blastRadius: { rating: 'MEDIUM' as const, explanation: 'risk' },
    mergeVerdict: { status: 'NEEDS_REVISION' as const, overallScore: 40, keyBlockers: ['k'], actionableFeedbackForAgent: 'fix' },
  };
}

describe('buildFailureBrief grade preference + enrichment', () => {
  it('prefers grade verdict/score when grade present', () => {
    const graded = attachAuditGrade(report() as never, { criteria: [] });
    const brief = buildFailureBrief(graded as never, blueprint, []);
    expect(brief.verdict).toBe(graded.grade.verdict);
    expect(brief.score).toBe(graded.grade.overallScore);
  });

  it('falls back to mergeVerdict for legacy reports without grade', () => {
    const brief = buildFailureBrief(report() as never, blueprint, []);
    expect(brief.verdict).toBe('NEEDS_REVISION');
  });

  it('unions client + model + grade unauthorized paths add-only', () => {
    const graded = attachAuditGrade(report() as never, {
      diffFacts: { filesTouched: 1, linesAdded: 1, linesRemoved: 0, unauthorizedCount: 1, unauthorizedPaths: ['extra.ts'] },
    });
    const brief = buildFailureBrief(graded as never, blueprint, ['client.ts']);
    expect(brief.unauthorizedPaths).toEqual(expect.arrayContaining(['package.json', 'client.ts', 'extra.ts']));
  });

  it('doNotTouch includes MET-cited paths but unauthorizedPaths does not', () => {
    const brief = buildFailureBrief(report() as never, blueprint, []);
    expect(brief.doNotTouch).toContain('src/a.ts');
    expect(brief.unauthorizedPaths).not.toContain('src/a.ts');
  });

  it('requiredFixes ordered UNMET before PARTIAL with Remaining/Satisfied', () => {
    const brief = buildFailureBrief(report() as never, blueprint, []);
    expect(brief.requiredFixes[0]).toMatch(/^\[UNMET\]/);
    expect(brief.requiredFixes[0]).toContain('Remaining: Add handler');
    expect(brief.requiredFixes[1]).toContain('Satisfied: Happy path');
  });

  it('evidenceById prefers holds for MET/PARTIAL and gap for UNMET', () => {
    const brief = buildFailureBrief(report() as never, blueprint, []);
    expect(brief.evidenceById?.['1']).toContain('Sealed impl');
    expect(brief.evidenceById?.['2']).toContain('Add handler');
    expect(brief.evidenceById?.['3']).toContain('Happy path');
  });
});
