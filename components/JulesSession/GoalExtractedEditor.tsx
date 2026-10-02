'use client';

import React, { useState } from 'react';
import type { GoalExtracted } from '@/lib/goals/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Plus, Trash2, ArrowLeft, Send, CheckCircle2 } from 'lucide-react';

export interface GoalExtractedEditorProps {
  extracted: GoalExtracted;
  onChange: (updated: GoalExtracted) => void;
  onBack: () => void;
  onConfirm: () => void;
  onSkip: () => void;
  isSaving?: boolean;
}

export function GoalExtractedEditor({
  extracted,
  onChange,
  onBack,
  onConfirm,
  onSkip,
  isSaving = false,
}: GoalExtractedEditorProps) {
  const [newCriterion, setNewCriterion] = useState('');

  const isUnclear = extracted.title === 'UNCLEAR' || extracted.ambiguityFlags.length > 0;

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...extracted, title: e.target.value });
  };

  const handleScopeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...extracted, scope: e.target.value });
  };

  const handleCriterionChange = (index: number, val: string) => {
    const updated = [...extracted.acceptanceCriteria];
    updated[index] = val;
    onChange({ ...extracted, acceptanceCriteria: updated });
  };

  const handleRemoveCriterion = (index: number) => {
    const updated = extracted.acceptanceCriteria.filter((_, i) => i !== index);
    onChange({ ...extracted, acceptanceCriteria: updated });
  };

  const handleAddCriterion = () => {
    if (!newCriterion.trim()) return;
    onChange({
      ...extracted,
      acceptanceCriteria: [...extracted.acceptanceCriteria, newCriterion.trim()],
    });
    setNewCriterion('');
  };

  return (
    <div className="space-y-4">
      {isUnclear && (
        <Alert variant="destructive" className="bg-amber-50 border-amber-200 text-amber-900">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-xs font-bold text-amber-800">
            Ambiguity or Incomplete Task Requirements Detected
          </AlertTitle>
          <AlertDescription className="text-[11px] text-amber-700 mt-1 space-y-1">
            <p>Gemini flagged potential ambiguity in your instructions. Please review and clarify below:</p>
            {extracted.ambiguityFlags.map((flag, idx) => (
              <p key={idx} className="font-mono text-[10px] bg-amber-100/60 p-1 rounded">
                • {flag}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* Goal Title */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-700">Goal Summary Title</label>
        <Input
          value={extracted.title}
          onChange={handleTitleChange}
          placeholder="e.g. Add empty-scan save guard"
          className="text-xs bg-white font-medium"
        />
      </div>

      {/* Goal Scope */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-700">Expected Scope & File Boundaries</label>
        <Input
          value={extracted.scope}
          onChange={handleScopeChange}
          placeholder="e.g. lib/goals/storage.ts, app/api/goal/extract/route.ts"
          className="text-xs font-mono bg-white"
        />
      </div>

      {/* Acceptance Criteria */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-700">Extracted Acceptance Criteria</label>
          <Badge variant="outline" className="text-[10px] text-slate-500">
            {extracted.acceptanceCriteria.length} criteria
          </Badge>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {extracted.acceptanceCriteria.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-slate-400 w-5 text-right">{idx + 1}.</span>
              <Input
                value={item}
                onChange={(e) => handleCriterionChange(idx, e.target.value)}
                className="text-xs bg-white flex-1"
              />
              <button
                type="button"
                onClick={() => handleRemoveCriterion(idx)}
                className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                title="Remove criterion"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Add Criterion Input */}
        <div className="flex items-center gap-2 pt-1">
          <Input
            value={newCriterion}
            onChange={(e) => setNewCriterion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddCriterion();
              }
            }}
            placeholder="Add new acceptance criterion..."
            className="text-xs bg-white flex-1"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleAddCriterion}
            className="h-9 px-3 text-xs bg-slate-800 text-white hover:bg-slate-700 gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </div>

      {/* Inferred Assumptions */}
      {extracted.assumptions.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-slate-100">
          <label className="text-xs font-semibold text-slate-700">Inferred Technical Assumptions</label>
          <ul className="text-[11px] text-slate-600 space-y-1 list-disc list-inside bg-slate-50 p-2.5 rounded-lg border border-slate-200/60">
            {extracted.assumptions.map((asm, idx) => (
              <li key={idx}>{asm}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBack}
            className="text-xs gap-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Edit Raw Text
          </Button>

          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
          >
            Skip & Dispatch Raw
          </button>
        </div>

        <Button
          type="button"
          onClick={onConfirm}
          disabled={isSaving || !extracted.title.trim()}
          className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold gap-2"
        >
          {isSaving ? (
            <>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Saving Goal & Dispatching...</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Confirm & Dispatch to Jules</span>
              <Send className="h-3.5 w-3.5" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
