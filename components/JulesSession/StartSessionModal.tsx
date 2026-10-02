'use client';

import React, { useState } from 'react';
import type { RepoProfile } from '@/lib/types/steering';
import type { Goal, GoalExtracted } from '@/lib/goals/types';
import { saveGoal } from '@/lib/goals/storage';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { GoalRawInput } from './GoalRawInput';
import { GoalExtractedEditor } from './GoalExtractedEditor';
import { AlertCircle, Target } from 'lucide-react';

export interface StartSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  repo: string;
  repoProfile?: RepoProfile;
  passphrase?: string;
  geminiApiKey?: string;
  initialRawText?: string;
  onConfirmAndDispatch: (goal: Goal, extractedCriteria?: string[]) => Promise<void> | void;
}

export function StartSessionModal({
  isOpen,
  onClose,
  repo,
  repoProfile,
  passphrase,
  geminiApiKey,
  initialRawText = '',
  onConfirmAndDispatch,
}: StartSessionModalProps) {
  const [step, setStep] = useState<'input' | 'review'>('input');
  const [rawText, setRawText] = useState(initialRawText);
  const [extracted, setExtracted] = useState<GoalExtracted | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setStep('input');
      setRawText(initialRawText);
      setExtracted(null);
      setError(null);
      setIsExtracting(false);
      setIsSaving(false);
    }
  }

  const handleExtract = async () => {
    if (!rawText.trim()) return;
    setError(null);
    setIsExtracting(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (geminiApiKey?.trim()) {
        headers['x-gemini-api-key'] = geminiApiKey.trim();
      }

      const res = await fetch('/api/goal/extract', {
        method: 'POST',
        headers,
        body: JSON.stringify({ rawText, repoProfile }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Goal extraction failed.');
      }

      setExtracted(data.extracted);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Goal extraction failed.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleConfirm = async () => {
    if (!extracted) return;
    setError(null);
    setIsSaving(true);

    const goalId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'goal-' + Date.now();
    const sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);

    const goal: Goal = {
      id: goalId,
      sessionId,
      repo,
      rawText,
      extracted,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await saveGoal(goal, passphrase);
    } catch {
      setError('Failed to save goal to vault — please check your passphrase and retry.');
      setIsSaving(false);
      return;
    }

    try {
      await onConfirmAndDispatch(goal, extracted.acceptanceCriteria);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dispatch session.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkip = async () => {
    if (!rawText.trim()) return;
    setError(null);
    setIsSaving(true);

    const goalId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'goal-' + Date.now();
    const sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);

    const goal: Goal = {
      id: goalId,
      sessionId,
      repo,
      rawText,
      extracted: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await saveGoal(goal, passphrase);
    } catch {
      setError('Failed to save goal to vault — please check your passphrase and retry.');
      setIsSaving(false);
      return;
    }

    try {
      await onConfirmAndDispatch(goal, undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dispatch session.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Target className="h-5 w-5 text-indigo-600" />
            <span>Start Jules Session — Goal Ingestion</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Define operator task requirements and review Gemini-extracted criteria before dispatching to Google Jules.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="my-2">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="text-xs font-bold">Session Error</AlertTitle>
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        <div className="py-2">
          {step === 'input' ? (
            <GoalRawInput
              rawText={rawText}
              setRawText={setRawText}
              onExtract={handleExtract}
              onSkip={handleSkip}
              isExtracting={isExtracting}
              disabled={isSaving}
            />
          ) : (
            extracted && (
              <GoalExtractedEditor
                extracted={extracted}
                onChange={setExtracted}
                onBack={() => setStep('input')}
                onConfirm={handleConfirm}
                onSkip={handleSkip}
                isSaving={isSaving}
              />
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
