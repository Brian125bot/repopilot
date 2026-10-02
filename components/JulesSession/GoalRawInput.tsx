'use client';

import * as React from 'react';
import { AlertTriangle, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface GoalRawInputProps {
  initialText?: string;
  onExtract: (rawText: string) => void;
  onSkip: (rawText: string) => void;
  isExtracting: boolean;
  /** Shown above the textarea; the modal owns extraction and save failures. */
  error?: string | null;
}

/**
 * COR-56 step 1 — freeform operator intent. Nothing is dispatched from here:
 * the operator must either extract a structured goal or explicitly skip.
 */
export function GoalRawInput({
  initialText = '',
  onExtract,
  onSkip,
  isExtracting,
  error,
}: GoalRawInputProps) {
  const [rawText, setRawText] = React.useState(initialText);
  const isEmpty = rawText.trim().length === 0;
  const disabled = isEmpty || isExtracting;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="goal-raw-text" className="text-xs font-semibold text-slate-700">
            What should this session accomplish?
          </label>
          <span className="text-[11px] tabular-nums text-slate-400">{rawText.length} characters</span>
        </div>
        <Textarea
          id="goal-raw-text"
          rows={7}
          value={rawText}
          disabled={isExtracting}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={
            'Describe the feature, fix, or ticket in your own words. Gemini turns this into a reviewable title, scope, and verifiable acceptance criteria.'
          }
          className="text-xs leading-relaxed"
        />
        <p className="text-[11px] text-slate-500">
          Nothing is sent anywhere until you choose Extract or Skip, and the extracted goal always comes
          back for review before it can be saved or dispatched.
        </p>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onSkip(rawText)}
          className="text-xs"
        >
          Skip extraction
        </Button>

        <Button
          type="button"
          variant="accent"
          size="sm"
          disabled={disabled}
          onClick={() => onExtract(rawText)}
          className="text-xs font-semibold"
        >
          {isExtracting ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Extracting with Gemini…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Extract Goal
              <ArrowRight className="h-3.5 w-3.5" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}