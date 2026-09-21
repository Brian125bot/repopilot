'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, ArrowRight } from 'lucide-react';

export type GoalRawInputProps = {
  initialText?: string;
  onExtract: (rawText: string) => Promise<void>;
  onSkip: (rawText: string) => void;
  isExtracting: boolean;
};

export function GoalRawInput({
  initialText = '',
  onExtract,
  onSkip,
  isExtracting,
}: GoalRawInputProps) {
  const [rawText, setRawText] = React.useState(initialText);

  const isTextEmpty = !rawText.trim();

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isTextEmpty || isExtracting) return;
    await onExtract(rawText);
  };

  const handleSkip = () => {
    if (isTextEmpty) return;
    onSkip(rawText);
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="goal-raw-textarea" className="block text-sm font-medium text-slate-800 mb-1.5">
          Goal Description
        </label>
        <p className="text-xs text-slate-500 mb-2">
          Describe the feature, bug fix, or task objective in plain text. Gemini will extract structured title, scope, and criteria for operator review.
        </p>
        <Textarea
          id="goal-raw-textarea"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder="e.g. Add a /healthz endpoint that returns 200 with {status:'ok', uptime:<seconds>} and document it in the README."
          className="min-h-[140px] text-sm font-mono"
          disabled={isExtracting}
        />
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSkip}
          disabled={isTextEmpty || isExtracting}
        >
          Skip extraction
        </Button>

        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={handleExtract}
          disabled={isTextEmpty || isExtracting}
        >
          {isExtracting ? (
            <>
              <Sparkles className="h-4 w-4 animate-spin text-amber-300" />
              Extracting...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 text-amber-300" />
              Extract with Gemini
              <ArrowRight className="h-4 w-4 ml-1" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
