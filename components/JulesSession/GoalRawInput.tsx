'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, ArrowRight } from 'lucide-react';

export interface GoalRawInputProps {
  rawText: string;
  setRawText: (text: string) => void;
  onExtract: () => void;
  onSkip: () => void;
  isExtracting: boolean;
  disabled?: boolean;
}

export function GoalRawInput({
  rawText,
  setRawText,
  onExtract,
  onSkip,
  isExtracting,
  disabled = false,
}: GoalRawInputProps) {
  const charCount = rawText.length;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-800 flex items-center justify-between">
          <span>Task Goal & Freeform Description</span>
          <span className="text-xs text-slate-400 font-mono">{charCount} chars</span>
        </label>
        <Textarea
          placeholder="Paste ticket requirements, feature requests, or freeform bug descriptions here..."
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={6}
          disabled={isExtracting || disabled}
          className="text-xs font-mono bg-white border-slate-200 focus:border-indigo-500"
        />
        <p className="text-[11px] text-slate-500">
          Enter freeform instructions. Gemini will extract structured acceptance criteria, file scope boundaries, and identify potential ambiguities.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={onSkip}
          disabled={isExtracting || disabled || !rawText.trim()}
          className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2 disabled:opacity-50"
        >
          Skip extraction & dispatch raw prompt
        </button>

        <Button
          type="button"
          onClick={onExtract}
          disabled={isExtracting || disabled || !rawText.trim()}
          className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold gap-2"
        >
          {isExtracting ? (
            <>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Extracting Goal with Gemini...</span>
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              <span>Extract Goal & Review</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
