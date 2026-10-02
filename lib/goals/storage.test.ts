import { describe, expect, it } from 'vitest';
import {
  GOAL_VAULT_PASSPHRASE_REQUIRED,
  GOAL_VAULT_READ_FAILED,
  GOAL_VAULT_SAVE_FAILED,
  createMemoryGoalRecordStore,
  deleteGoal,
  getGoal,
  isGoalVaultError,
  saveGoal,
  type GoalRecordStore,
} from './storage';
import { GOAL_UNCLEAR_TITLE, buildGoal, buildDraftSessionId, parseGoal, type Goal } from './types';

const PASS = 'correct horse battery staple';
const WRONG_PASS = 'incorrect horse battery staple';

/** Hermetic: no IndexedDB, no globals, no network. Real WebCrypto does the work. */
function extractedGoal() {
  return {
    title: 'Add empty-scan save guard',
    scope: ['lib/repo-profile/save-policy.ts'],
    acceptanceCriteria: [
      'npm test lib/repo-profile/save-policy.test.ts covers the empty-scan refusal',
      'No dependency manifest changes',
    ],
    assumptions: ['The scanner keeps its current four-stage shape'],
    ambiguityFlags: [] as string[],
  };
}

function makeGoal(overrides: Partial<Parameters<typeof buildGoal>[0]> = {}): Goal {
  return buildGoal({
    sessionId: 'draft-session-1',
    repo: 'acme/api-gateway',
    rawText: 'Add an empty-scan save guard so a cancelled scan cannot overwrite a saved profile.',
    extracted: extractedGoal(),
    ...overrides,
  });
}

describe('Goal vault storage', () => {
  it('round-trips an extracted goal through encryption', async () => {
    const store = createMemoryGoalRecordStore();
    const goal = makeGoal();

    await saveGoal(goal, PASS, store);
    const loaded = await getGoal(goal.sessionId, PASS, store);

    expect(loaded).toEqual(goal);
    expect(loaded?.extracted).toEqual(extractedGoal());
    expect(loaded?.repo).toBe('acme/api-gateway');
  });

  it('round-trips a skipped-extraction goal with extracted: null', async () => {
    const store = createMemoryGoalRecordStore();
    const goal = makeGoal({ extracted: null });

    await saveGoal(goal, PASS, store);
    const loaded = await getGoal(goal.sessionId, PASS, store);

    expect(loaded).not.toBeNull();
    expect(loaded?.extracted).toBeNull();
    expect(loaded?.rawText).toBe(goal.rawText);
  });

  it('round-trips an UNCLEAR goal with its ambiguity flags intact', async () => {
    const store = createMemoryGoalRecordStore();
    const goal = makeGoal({
      extracted: {
        ...extractedGoal(),
        title: GOAL_UNCLEAR_TITLE,
        acceptanceCriteria: [],
        ambiguityFlags: ['no target system mentioned', 'no acceptance criteria stated'],
      },
    });

    await saveGoal(goal, PASS, store);
    const loaded = await getGoal(goal.sessionId, PASS, store);

    expect(loaded?.extracted?.title).toBe(GOAL_UNCLEAR_TITLE);
    expect(loaded?.extracted?.ambiguityFlags).toEqual([
      'no target system mentioned',
      'no acceptance criteria stated',
    ]);
  });

  it('stores ciphertext only — no plaintext survives the envelope', async () => {
    const store = createMemoryGoalRecordStore();
    const goal = makeGoal();

    await saveGoal(goal, PASS, store);
    const envelope = await store.read(goal.sessionId);

    expect(envelope).not.toBeNull();
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain(goal.rawText);
    expect(serialized).not.toContain('Add empty-scan save guard');
    expect(serialized).not.toContain(goal.repo);
    expect(serialized).not.toContain(PASS);
    // A distinct salt/IV per write means no envelope is reused verbatim.
    expect(envelope!.saltB64.length).toBeGreaterThan(0);
    expect(envelope!.ivB64.length).toBeGreaterThan(0);
  });

  it('rejects a wrong passphrase instead of returning a broken goal', async () => {
    const store = createMemoryGoalRecordStore();
    const goal = makeGoal();
    await saveGoal(goal, PASS, store);

    await expect(getGoal(goal.sessionId, WRONG_PASS, store)).rejects.toThrow(GOAL_VAULT_READ_FAILED);
  });

  it('returns null for an unknown session id', async () => {
    const store = createMemoryGoalRecordStore();
    expect(await getGoal('draft-never-saved', PASS, store)).toBeNull();
  });

  it('overwrites the goal when the same session id is saved twice', async () => {
    const store = createMemoryGoalRecordStore();
    const first = makeGoal();
    const second = makeGoal({
      extracted: { ...extractedGoal(), title: 'Revised title after operator edit' },
    });

    await saveGoal(first, PASS, store);
    await saveGoal(second, PASS, store);

    const loaded = await getGoal(second.sessionId, PASS, store);
    expect(loaded?.extracted?.title).toBe('Revised title after operator edit');
  });

  it('deletes a stored goal', async () => {
    const store = createMemoryGoalRecordStore();
    const goal = makeGoal();
    await saveGoal(goal, PASS, store);

    await deleteGoal(goal.sessionId, store);
    expect(await getGoal(goal.sessionId, PASS, store)).toBeNull();
  });
});

describe('Goal vault storage failure surfacing', () => {
  it('throws a descriptive VaultError when the IndexedDB write fails', async () => {
    const failing: GoalRecordStore = {
      read: async () => null,
      write: async () => {
        throw new Error('QuotaExceededError');
      },
      delete: async () => undefined,
    };

    // A silent failure here is the exact defect COR-56 was held for.
    await expect(saveGoal(makeGoal(), PASS, failing)).rejects.toThrow(GOAL_VAULT_SAVE_FAILED);
  });

  it('marks write failures as GoalVaultError and keeps the underlying cause', async () => {
    const failing: GoalRecordStore = {
      read: async () => null,
      write: async () => {
        throw new Error('QuotaExceededError');
      },
      delete: async () => undefined,
    };

    await saveGoal(makeGoal(), PASS, failing).then(
      () => {
        throw new Error('saveGoal resolved when the store rejected the write');
      },
      (err: unknown) => {
        expect(isGoalVaultError(err)).toBe(true);
        expect((err as { cause?: unknown }).cause).toBeInstanceOf(Error);
      }
    );
  });

  it('throws a descriptive VaultError when the IndexedDB read fails', async () => {
    const failing: GoalRecordStore = {
      read: async () => {
        throw new Error('Database is not open');
      },
      write: async () => undefined,
      delete: async () => undefined,
    };

    await expect(getGoal('draft-1', PASS, failing)).rejects.toThrow(GOAL_VAULT_READ_FAILED);
  });

  it('refuses to save or read without a passphrase', async () => {
    const store = createMemoryGoalRecordStore();
    await expect(saveGoal(makeGoal(), '', store)).rejects.toThrow(GOAL_VAULT_PASSPHRASE_REQUIRED);
    await expect(saveGoal(makeGoal(), undefined, store)).rejects.toThrow(GOAL_VAULT_PASSPHRASE_REQUIRED);
    await expect(getGoal('draft-1', '   ', store)).rejects.toThrow(GOAL_VAULT_PASSPHRASE_REQUIRED);
  });

  it('refuses to save a goal that fails schema validation', async () => {
    const store = createMemoryGoalRecordStore();
    const invalid = { ...makeGoal(), repo: '' } as Goal;

    await expect(saveGoal(invalid, PASS, store)).rejects.toThrow(/repo/i);
    expect(await store.read(invalid.sessionId)).toBeNull();
  });
});

describe('buildGoal', () => {
  it('stamps a uuid id and ISO timestamps', () => {
    const goal = makeGoal();
    expect(goal.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(Number.isNaN(Date.parse(goal.createdAt))).toBe(false);
    expect(goal.createdAt).toBe(goal.updatedAt);
  });

  it('accepts an injected clock for deterministic timestamps', () => {
    const goal = makeGoal({ now: '2026-10-02T12:00:00.000Z' });
    expect(goal.createdAt).toBe('2026-10-02T12:00:00.000Z');
    expect(goal.updatedAt).toBe('2026-10-02T12:00:00.000Z');
  });

  it('falls back to a draft session id when none is supplied', () => {
    const goal = buildGoal({ repo: 'acme/api', rawText: 'do a thing', extracted: null });
    expect(goal.sessionId).toMatch(/^draft-/);
    expect(buildDraftSessionId()).toMatch(/^draft-/);
    expect(buildDraftSessionId()).not.toBe(goal.sessionId);
  });

  it('rejects a blank raw text rather than storing an empty goal', () => {
    expect(() => buildGoal({ repo: 'acme/api', rawText: '   ', extracted: null })).toThrow(/raw text/i);
  });
});

describe('Goal record parsing', () => {
  it('drops unknown keys from extracted output but rejects unknown top-level keys', () => {
    const base = makeGoal();
    const withExtra = { ...base, extracted: { ...base.extracted!, confidence: 0.9 } } as unknown;
    expect(parseGoal(withExtra).extracted).not.toHaveProperty('confidence');

    expect(() => parseGoal({ ...base, operatorNotes: 'nope' })).toThrow();
  });

  it('rejects an UNCLEAR goal with no ambiguity flags', () => {
    const base = makeGoal();
    expect(() =>
      parseGoal({
        ...base,
        extracted: { ...extractedGoal(), title: GOAL_UNCLEAR_TITLE, ambiguityFlags: [] },
      })
    ).toThrow(/ambiguityFlags/i);
  });
});