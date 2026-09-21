'use client';

import * as React from 'react';
import { Goal, GoalExtracted } from '@/lib/goals/types';
import { saveGoal } from '@/lib/goals/storage';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GoalRawInput } from './GoalRawInput';
import { GoalExtractedEditor } from './GoalExtractedEditor';
import { AlertCircle } from 'lucide-react';

export type StartSessionModalProps = {
  isOpen: boolean;
  sessionId: string;
  passphrase?: string;
  geminiApiKey?: string;
  initialRawText?: string;
  onConfirm: (goal: Goal) => void;
  onCancel: () => void;
};

export function StartSessionModal({
  isOpen,
  sessionId,
  passphrase,
  geminiApiKey,
  initialRawText = '',
  onConfirm,
  onCancel,
}: StartSessionModalProps) {
  const [step, setStep] = React.useState<'raw' | 'editor'>('raw');
  const [rawText, setRawText] = React.useState(initialRawText);
  const [extracted, setExtracted] = React.useState<GoalExtracted | null>(null);
  const [isExtracting, setIsExtracting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setStep('raw');
        setRawText(initialRawText);
        setExtracted(null);
        setError(null);
        setIsExtracting(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialRawText]);

  const handleExtract = async (inputRawText: string) => {
    setError(null);
    setIsExtracting(true);
    setRawText(inputRawText);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (geminiApiKey) {
        headers['x-gemini-api-key'] = geminiApiKey;
      }

      const res = await fetch('/api/goal/extract', {
        method: 'POST',
        headers,
        body: JSON.stringify({ rawText: inputRawText }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Failed to extract goal requirements.');
      }

      const extractedData: GoalExtracted = await res.json();
      setExtracted(extractedData);
      setStep('editor');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to extract goal requirements.';
      setError(msg);
    } finally {
      setIsExtracting(false);
    }
  };

  const persistAndConfirm = async (goal: Goal) => {
    if (passphrase) {
      try {
        await saveGoal(goal, passphrase);
      } catch (err) {
        console.warn('Failed to encrypt and store goal in vault:', err);
      }
    }
    onConfirm(goal);
  };

  const handleSkip = (inputRawText: string) => {
    const now = new Date().toISOString();
    const goal: Goal = {
      sessionId,
      rawText: inputRawText,
      extracted: null,
      createdAt: now,
      updatedAt: now,
    };
    void persistAndConfirm(goal);
  };

  const handleEditorConfirm = (edited: GoalExtracted) => {
    const now = new Date().toISOString();
    const goal: Goal = {
      sessionId,
      rawText,
      extracted: edited,
      createdAt: now,
      updatedAt: now,
    };
    void persistAndConfirm(goal);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogHeader onClose={onCancel}>
        <DialogTitle>
          {step === 'raw' ? 'Start Jules Session — Goal Ingestion' : 'Goal Review & Edit'}
        </DialogTitle>
        <DialogDescription>
          {step === 'raw'
            ? 'Define operator intent in free text to establish goals and evaluation criteria.'
            : 'Review and edit extracted scope, criteria, and assumptions before launching.'}
        </DialogDescription>
      </DialogHeader>

      <DialogContent>
        {error && (
          <div className="flex items-center gap-2 p-3 text-xs bg-red-50 border border-red-200 text-red-800 rounded-lg">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {step === 'raw' && (
          <GoalRawInput
            initialText={rawText}
            onExtract={handleExtract}
            onSkip={handleSkip}
            isExtracting={isExtracting}
          />
        )}

        {step === 'editor' && extracted && (
          <GoalExtractedEditor
            extracted={extracted}
            rawText={rawText}
            onConfirm={handleEditorConfirm}
            onBack={() => setStep('raw')}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
