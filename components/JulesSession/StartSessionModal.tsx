'use client';

import * as React from 'react';
import { AlertTriangle, KeyRound, Sparkles, Target } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { GoalRawInput } from '@/components/JulesSession/GoalRawInput';
import { GoalExtractedEditor } from '@/components/JulesSession/GoalExtractedEditor';
import {
  buildDraftSessionId,
  buildGoal,
  GoalExtractedSchema,
  type Goal,
  type GoalExtracted,
} from '@/lib/goals/types';
import { GOAL_VAULT_SAVE_FAILED, saveGoal } from '@/lib/goals/storage';
import { indexedDbSteeringStore } from '@/lib/vault/steering-store';
import type { RepoProfile } from '@/lib/types/steering';

/** What Confirm does once the goal is safely in the vault. */
export type StartSessionIntent = 'dispatch' | 'goal-only';

export interface StartSessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `owner/repo` — used to look up the saved COR-54 profile for grounding. */
  repo: string;
  /** Client-side vault key; sent as `x-gemini-api-key` and never stored server-side. */
  geminiApiKey: string;
  initialRawText?: string;
  intent: StartSessionIntent;
  onConfirm: (goal: Goal) => void;
  onCancel: () => void;
}

interface ExtractResponse {
  success?: boolean;
  title?: string;
  scope?: string[];
  acceptanceCriteria?: string[];
  assumptions?: string[];
  ambiguityFlags?: string[];
  error?: string;
  message?: string;
}

/**
 * COR-56 goal ingestion.
 *
 * Raw text → Gemini extraction → operator review/edit → encrypted save. Nothing
 * is persisted or dispatched without the operator pressing Confirm or Skip
 * extraction.
 *
 * The passphrase is typed here and used for exactly two things: reading the
 * saved repo profile to ground the extraction, and encrypting the goal before it
 * reaches IndexedDB. All wizard state — the passphrase included — lives in
 * `StartSessionWizard`, which only mounts while the dialog is open, so closing
 * the dialog discards it without an effect.
 */
export function StartSessionModal(props: StartSessionModalProps) {
  const { open, onOpenChange, onCancel } = props;

  const handleClose = React.useCallback(() => {
    onOpenChange(false);
    onCancel();
  }, [onCancel, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      {open ? <StartSessionWizard {...props} onClose={handleClose} /> : null}
    </Dialog>
  );
}

interface StartSessionWizardProps extends StartSessionModalProps {
  onClose: () => void;
}

function StartSessionWizard({
  repo,
  geminiApiKey,
  initialRawText = '',
  intent,
  onConfirm,
  onOpenChange,
  onClose,
}: StartSessionWizardProps) {
  const [step, setStep] = React.useState<'raw' | 'review'>('raw');
  const [rawText, setRawText] = React.useState(initialRawText);
  const [extracted, setExtracted] = React.useState<GoalExtracted | null>(null);
  // Bumping this remounts the editor so a re-extraction cannot inherit stale edits.
  const [extractionId, setExtractionId] = React.useState(0);
  const [passphrase, setPassphrase] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [isExtracting, setIsExtracting] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  /** Best-effort profile lookup. A missing or locked profile must not block extraction. */
  const loadRepoProfile = React.useCallback(async (): Promise<RepoProfile | undefined> => {
    const ref = repo.trim();
    if (!ref || !passphrase.trim()) return undefined;
    try {
      const store = indexedDbSteeringStore();
      store.unlock(passphrase);
      const profile = await store.getRepoProfile(ref);
      if (!profile) {
        setNotice('No saved repository profile matched this repo, so extraction is not grounded in stack details.');
      }
      return profile ?? undefined;
    } catch {
      setNotice('No saved repository profile was readable, so extraction is not grounded in stack details.');
      return undefined;
    }
  }, [passphrase, repo]);

  const handleExtract = React.useCallback(
    async (text: string) => {
      setError(null);
      setNotice(null);
      setIsExtracting(true);
      const trimmed = text.trim();
      setRawText(trimmed);

      try {
        const repoProfile = await loadRepoProfile();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (geminiApiKey) headers['x-gemini-api-key'] = geminiApiKey;

        const res = await fetch('/api/goal/extract', {
          method: 'POST',
          headers,
          body: JSON.stringify({ rawText: trimmed, repoProfile }),
        });

        const data = (await res.json().catch(() => ({}))) as ExtractResponse;
        if (!res.ok) {
          throw new Error(data.message || data.error || 'Failed to extract the goal with Gemini.');
        }

        const parsed = GoalExtractedSchema.safeParse(data);
        if (!parsed.success) {
          throw new Error('Gemini returned a goal in an unexpected shape. Use Skip extraction to continue.');
        }

        setExtracted(parsed.data);
        setExtractionId((id) => id + 1);
        setStep('review');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to extract the goal with Gemini.');
      } finally {
        setIsExtracting(false);
      }
    },
    [geminiApiKey, loadRepoProfile]
  );

  /**
   * The single exit from the wizard. The goal is encrypted and written to the
   * vault before anything else happens; a failure renders a visible notice and
   * keeps the dialog open instead of dispatching a goal that was never stored.
   */
  const persistAndConfirm = React.useCallback(
    async (goalExtracted: GoalExtracted | null, sourceText: string) => {
      if (!passphrase.trim()) {
        setSaveError('Enter your vault passphrase so the goal can be encrypted before it is saved.');
        return;
      }

      setIsSaving(true);
      setSaveError(null);

      let goal: Goal;
      try {
        goal = buildGoal({
          sessionId: buildDraftSessionId(),
          repo: repo.trim() || 'unknown/unknown',
          rawText: sourceText,
          extracted: goalExtracted,
        });
      } catch (err: unknown) {
        setIsSaving(false);
        setSaveError(
          err instanceof Error ? err.message : 'The goal could not be prepared for saving. Check the fields.'
        );
        return;
      }

      try {
        await saveGoal(goal, passphrase);
      } catch {
        setIsSaving(false);
        setSaveError(GOAL_VAULT_SAVE_FAILED);
        return;
      }

      setIsSaving(false);
      onOpenChange(false);
      onConfirm(goal);
    },
    [onConfirm, onOpenChange, passphrase, repo]
  );

  const handleSkip = React.useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      void persistAndConfirm(null, trimmed);
    },
    [persistAndConfirm]
  );

  const handleEditorConfirm = React.useCallback(
    (edited: GoalExtracted) => {
      void persistAndConfirm(edited, rawText);
    },
    [persistAndConfirm, rawText]
  );

  const passphraseMissing = !passphrase.trim();

  return (
    <>
      <DialogHeader onClose={onClose}>
        <DialogTitle className="flex items-center gap-2 text-sm">
          <Target className="h-4 w-4 text-indigo-600" />
          {step === 'raw' ? 'Start Jules Session — Goal Ingestion' : 'Review the extracted goal'}
        </DialogTitle>
        <DialogDescription>
          {step === 'raw'
            ? 'Describe the work, extract a structured goal, and review it before anything is saved or dispatched.'
            : 'Edit anything Gemini got wrong. Nothing is saved or dispatched until you confirm.'}
        </DialogDescription>
      </DialogHeader>

      <DialogContent>
        <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <label
            htmlFor="goal-vault-passphrase"
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"
          >
            <KeyRound className="h-3.5 w-3.5 text-indigo-600" />
            Vault passphrase
          </label>
          <Input
            id="goal-vault-passphrase"
            type="password"
            autoComplete="off"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Same passphrase you use to unlock credentials"
            className="text-xs"
          />
          <p className="text-[11px] leading-relaxed text-slate-500">
            Used only in this browser: to encrypt the goal before it is stored, and to read your saved
            repository profile for extraction grounding. It is never sent to the server, and it is
            discarded when this dialog closes.
          </p>
        </div>

        {notice && (
          <Alert variant="info">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">{notice}</AlertDescription>
          </Alert>
        )}

        {step === 'raw' ? (
          <GoalRawInput
            initialText={rawText}
            onExtract={(text) => void handleExtract(text)}
            onSkip={handleSkip}
            isExtracting={isExtracting}
            error={error}
          />
        ) : (
          extracted && (
            <GoalExtractedEditor
              key={extractionId}
              extracted={extracted}
              rawText={rawText}
              onConfirm={handleEditorConfirm}
              onBack={() => setStep('raw')}
              isSaving={isSaving}
              saveError={saveError}
              confirmLabel={intent === 'dispatch' ? 'Confirm & Dispatch' : 'Confirm & Save'}
            />
          )
        )}

        {step === 'raw' && saveError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">{saveError}</AlertDescription>
          </Alert>
        )}
      </DialogContent>

      {step === 'raw' && (
        <DialogFooter className="sm:justify-between">
          <p className="text-[11px] text-slate-500">
            {passphraseMissing
              ? 'A vault passphrase is required to save a goal.'
              : `Encrypted locally, then stored in IndexedDB${
                  repo.trim() ? ` for ${repo.trim()}` : ''
                }.`}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onClose} className="text-xs">
            Cancel
          </Button>
        </DialogFooter>
      )}

      {step === 'review' && intent === 'dispatch' && (
        <DialogFooter className="sm:justify-between">
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Sparkles className="h-3 w-3 text-indigo-500" />
            Confirming replaces the Stage 1 criteria list with the criteria reviewed above, then
            dispatches.
          </p>
          <span className="text-[11px] text-slate-400">Review above, then confirm.</span>
        </DialogFooter>
      )}
    </>
  );
}