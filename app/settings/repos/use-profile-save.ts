'use client';

import { useCallback, useMemo, useReducer } from 'react';
import { indexedDbSteeringStore } from '@/lib/vault/steering-store';
import { RepoProfile } from '@/lib/types/steering';
import {
  decideSave,
  EMPTY_REPLACE_MESSAGE,
  isProfileEmpty,
} from '@/lib/repo-profile/save-policy';
import {
  initialSaveFlowState,
  resolveSaveAction,
  saveFlowReducer,
  shouldAutoSave,
  SaveAction,
  SaveFlowState,
} from '@/lib/repo-profile/save-flow';
import { ScanResult } from '@/lib/repo-profile/types';

interface UseProfileSaveOptions {
  passphrase: string;
  isUnlocked: boolean;
  reloadProfiles: () => Promise<void>;
}

export interface ProfileSaveController {
  state: SaveFlowState;
  action: SaveAction;
  beginScan: () => void;
  applyScanResult: (result: ScanResult, existing: RepoProfile | null) => Promise<void>;
  requestSave: () => void;
  cancelConfirm: () => void;
  discard: () => void;
}

function messageFor(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Owns everything the scan-result card does with a scanned profile: the decision,
 * the write, the confirmation step, and the resulting button state. The page
 * component only renders what this returns.
 */
export function useProfileSave({
  passphrase,
  isUnlocked,
  reloadProfiles,
}: UseProfileSaveOptions): ProfileSaveController {
  const [state, dispatch] = useReducer(saveFlowReducer, initialSaveFlowState);
  const action = useMemo(() => resolveSaveAction(state), [state]);

  const beginScan = useCallback(() => dispatch({ type: 'scan_started' }), []);

  const persist = useCallback(
    async (profile: RepoProfile) => {
      const store = indexedDbSteeringStore();
      store.unlock(passphrase);
      // The write must resolve before any state claims the profile is stored.
      await store.saveRepoProfile(profile);
      await reloadProfiles();
    },
    [passphrase, reloadProfiles]
  );

  const applyScanResult = useCallback(
    async (result: ScanResult, existing: RepoProfile | null) => {
      const decision = decideSave(existing, result);
      const autoSave = shouldAutoSave(decision, existing, result.outcome);

      dispatch({
        type: 'scan_settled',
        decision,
        existing,
        autoSave,
        outcome: result.outcome,
      });

      if (!autoSave) return;

      try {
        await persist(decision.profile);
        dispatch({ type: 'save_succeeded' });
      } catch (err: unknown) {
        dispatch({
          type: 'save_failed',
          message: messageFor(err, 'Failed to save the scanned profile.'),
        });
      }
    },
    [persist]
  );

  const requestSave = useCallback(() => {
    const current = resolveSaveAction(state);
    // A disabled control must never accept a click, and a click on a destructive
    // replace stops at the confirmation instead of writing.
    if (current.disabled) return;

    if (current.requiresConfirm && !state.confirmPending) {
      dispatch({ type: 'save_requested' });
      return;
    }

    const decision = state.decision;
    if (!decision) return;

    // Defence in depth: the control is already disabled for an empty candidate.
    if (isProfileEmpty(decision.profile)) {
      dispatch({ type: 'save_failed', message: EMPTY_REPLACE_MESSAGE });
      return;
    }

    dispatch({ type: 'save_committed' });
    void (async () => {
      try {
        await persist(decision.profile);
        dispatch({ type: 'save_succeeded' });
      } catch (err: unknown) {
        dispatch({
          type: 'save_failed',
          message: messageFor(err, 'Failed to save profile'),
        });
      }
    })();
  }, [state, persist]);

  const cancelConfirm = useCallback(() => dispatch({ type: 'confirm_cancelled' }), []);

  const discard = useCallback(() => dispatch({ type: 'dismissed' }), []);

  return {
    state,
    action,
    beginScan,
    applyScanResult,
    requestSave,
    cancelConfirm,
    discard,
  };
}
