import { describe, expect, it } from 'vitest';
import {
  createMemoryGoalRecordStore,
  deleteGoal,
  loadGoal,
  saveGoal,
} from './storage';
import { Goal } from './types';

describe('Goal Storage', () => {
  const samplePassphrase = 'super-secret-passphrase-123';
  const wrongPassphrase = 'incorrect-passphrase-456';

  const sampleGoal: Goal = {
    sessionId: 'session_123',
    rawText: 'Add a /healthz endpoint returning 200 ok',
    extracted: {
      title: 'Add /healthz endpoint',
      scope: ['api/health'],
      acceptanceCriteria: ['Returns HTTP 200 with status ok'],
      assumptions: [],
      ambiguityFlags: [],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const skipGoal: Goal = {
    sessionId: 'session_456',
    rawText: 'Just some raw goal without extraction',
    extracted: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('saves and loads a goal with correct passphrase', async () => {
    const store = createMemoryGoalRecordStore();

    await saveGoal(sampleGoal, samplePassphrase, store);
    const loaded = await loadGoal(sampleGoal.sessionId, samplePassphrase, store);

    expect(loaded).toBeDefined();
    expect(loaded?.sessionId).toBe(sampleGoal.sessionId);
    expect(loaded?.rawText).toBe(sampleGoal.rawText);
    expect(loaded?.extracted).toEqual(sampleGoal.extracted);
  });

  it('saves and loads a goal with extracted: null (skip extraction path)', async () => {
    const store = createMemoryGoalRecordStore();

    await saveGoal(skipGoal, samplePassphrase, store);
    const loaded = await loadGoal(skipGoal.sessionId, samplePassphrase, store);

    expect(loaded).toBeDefined();
    expect(loaded?.sessionId).toBe(skipGoal.sessionId);
    expect(loaded?.rawText).toBe(skipGoal.rawText);
    expect(loaded?.extracted).toBeNull();
  });

  it('rejects loading with a wrong passphrase', async () => {
    const store = createMemoryGoalRecordStore();

    await saveGoal(sampleGoal, samplePassphrase, store);

    await expect(loadGoal(sampleGoal.sessionId, wrongPassphrase, store)).rejects.toThrow(
      'Incorrect passphrase — vault remains locked.'
    );
  });

  it('returns null when loading a non-existent goal', async () => {
    const store = createMemoryGoalRecordStore();

    const loaded = await loadGoal('non_existent_session', samplePassphrase, store);
    expect(loaded).toBeNull();
  });

  it('deletes a goal successfully', async () => {
    const store = createMemoryGoalRecordStore();

    await saveGoal(sampleGoal, samplePassphrase, store);
    const before = await loadGoal(sampleGoal.sessionId, samplePassphrase, store);
    expect(before).not.toBeNull();

    await deleteGoal(sampleGoal.sessionId, store);
    const after = await loadGoal(sampleGoal.sessionId, samplePassphrase, store);
    expect(after).toBeNull();
  });
});
