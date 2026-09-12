import { describe, it, expect } from 'vitest';
import {
  MAX_OUTCOME_ROWS,
  OUTCOME_LOG_KEY,
  appendOutcomeRow,
  buildOutcomeRow,
  exportOutcomeLog,
  updateOutcomeRow,
  type OutcomeLogRow,
} from '@/lib/outcome-memory';

const row = (overrides?: Partial<OutcomeLogRow>): OutcomeLogRow => ({
  blueprintId: 'bp_1',
  repo: 'acme-corp/api-gateway',
  sessionId: 'sessions/s_1',
  turn: 'initial',
  usedPriorSession: false,
  at: new Date().toISOString(),
  ...overrides,
});

describe('appendOutcomeRow', () => {
  it('appends in order', () => {
    const next = appendOutcomeRow([row()], row({ blueprintId: 'bp_2' }));

    expect(next).toHaveLength(2);
    expect(next[1].blueprintId).toBe('bp_2');
  });

  it(`caps at ${MAX_OUTCOME_ROWS} rows, dropping oldest first`, () => {
    expect(MAX_OUTCOME_ROWS).toBe(50);
    let rows: OutcomeLogRow[] = [];
    for (let i = 0; i < 52; i += 1) {
      rows = appendOutcomeRow(rows, row({ blueprintId: `bp_${i}` }));
    }

    expect(rows).toHaveLength(50);
    expect(rows[0].blueprintId).toBe('bp_2');
    expect(rows[49].blueprintId).toBe('bp_51');
  });
});

describe('turn enums', () => {
  it.each([
    { turn: 'initial', usedPriorSession: false },
    { turn: 'continuation', usedPriorSession: true },
    { turn: 'new-from-brief', usedPriorSession: true },
  ] as const)('records turn=$turn usedPriorSession=$usedPriorSession', ({ turn, usedPriorSession }) => {
    const built = buildOutcomeRow({
      blueprint: { blueprintId: 'bp_9', repo: 'acme-corp/api-gateway', sessionId: 'sessions/s_9' },
      turn,
      usedPriorSession,
    });

    expect(built.turn).toBe(turn);
    expect(built.usedPriorSession).toBe(usedPriorSession);
    expect(built.blueprintId).toBe('bp_9');
    expect(typeof built.at).toBe('string');
  });
});

describe('updateOutcomeRow', () => {
  it('fills the matching row and leaves others untouched', () => {
    const rows = [
      row({ blueprintId: 'bp_a', verdict: undefined }),
      row({ blueprintId: 'bp_b', verdict: undefined }),
    ];
    const next = updateOutcomeRow(rows, { blueprintId: 'bp_b' }, {
      verdict: 'NEEDS_REVISION',
      score: 62,
      unauthorizedCount: 1,
      unmetIds: ['2'],
    });

    expect(next[1]).toMatchObject({ verdict: 'NEEDS_REVISION', score: 62, unauthorizedCount: 1, unmetIds: ['2'] });
    expect(next[0].verdict).toBeUndefined();
    expect(rows[1].verdict).toBeUndefined();
  });

  it('prefers the most recent matching row', () => {
    const rows = [row({ blueprintId: 'bp_x' }), row({ blueprintId: 'bp_x' })];
    const next = updateOutcomeRow(rows, { blueprintId: 'bp_x' }, {
      verdict: 'READY_TO_MERGE',
      score: 100,
      unauthorizedCount: 0,
      unmetIds: [],
    });

    expect(next[0].verdict).toBeUndefined();
    expect(next[1].verdict).toBe('READY_TO_MERGE');
  });
});

describe('exportOutcomeLog', () => {
  it('round-trips rows as JSON without aggregates', () => {
    const json = exportOutcomeLog([row({ verdict: 'READY_TO_MERGE', score: 100 })]);
    const parsed = JSON.parse(json) as OutcomeLogRow[];

    expect(parsed).toHaveLength(1);
    expect(parsed[0].verdict).toBe('READY_TO_MERGE');
    expect(json).not.toContain('rate');
  });

  it('uses the documented storage key', () => {
    expect(OUTCOME_LOG_KEY).toBe('repopilot_outcome_log');
  });
});
