'use client';

import * as React from 'react';
import { GoalExtracted } from '@/lib/goals/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Plus, Trash2, ArrowLeft, Check } from 'lucide-react';

export type GoalExtractedEditorProps = {
  extracted: GoalExtracted;
  rawText: string;
  onConfirm: (edited: GoalExtracted) => void;
  onBack: () => void;
  isReadOnly?: boolean;
};

export function GoalExtractedEditor({
  extracted,
  rawText,
  onConfirm,
  onBack,
  isReadOnly = false,
}: GoalExtractedEditorProps) {
  const [title, setTitle] = React.useState(extracted.title);
  const [scope, setScope] = React.useState<string[]>([...extracted.scope]);
  const [acceptanceCriteria, setAcceptanceCriteria] = React.useState<string[]>([
    ...extracted.acceptanceCriteria,
  ]);
  const [assumptions, setAssumptions] = React.useState<string[]>([...extracted.assumptions]);
  const [ambiguityFlags] = React.useState<string[]>([...extracted.ambiguityFlags]);

  const isUnclear = title === 'UNCLEAR' || ambiguityFlags.length > 0;

  // List item helpers
  const handleItemChange = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    index: number,
    value: string
  ) => {
    const next = [...list];
    next[index] = value;
    setList(next);
  };

  const handleAddItem = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setList([...list, '']);
  };

  const handleRemoveItem = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    index: number
  ) => {
    setList(list.filter((_, i) => i !== index));
  };

  const handleConfirm = () => {
    onConfirm({
      title: title.trim() || 'Untitled Goal',
      scope: scope.map((s) => s.trim()).filter(Boolean),
      acceptanceCriteria: acceptanceCriteria.map((a) => a.trim()).filter(Boolean),
      assumptions: assumptions.map((a) => a.trim()).filter(Boolean),
      ambiguityFlags,
    });
  };

  return (
    <div className="space-y-5">
      {/* Ambiguity Alert if UNCLEAR */}
      {isUnclear && (
        <Alert variant="destructive" className="bg-amber-50 border-amber-200 text-amber-900">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-800 font-semibold">Goal Ambiguity Flagged</AlertTitle>
          <AlertDescription className="text-xs text-amber-700 mt-1 space-y-1">
            <p>Gemini flagged this goal as vague or ambiguous. Please review and refine the title and details below before confirming.</p>
            {ambiguityFlags.length > 0 && (
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {ambiguityFlags.map((flag, idx) => (
                  <li key={idx}>{flag}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Raw Text Summary */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
        <span className="font-semibold text-slate-700 block mb-1">Preserved Raw Text:</span>
        <p className="font-mono whitespace-pre-wrap">{rawText}</p>
      </div>

      {/* Title */}
      <div>
        <label htmlFor="extracted-title" className="block text-xs font-semibold text-slate-700 mb-1">
          Goal Title
        </label>
        <Input
          id="extracted-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isReadOnly}
          className="text-sm font-medium"
          placeholder="Concise summary of goal..."
        />
      </div>

      {/* Scope List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-700">Scope Areas / Modules</label>
          {!isReadOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleAddItem(scope, setScope)}
              className="h-7 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Scope
            </Button>
          )}
        </div>
        {scope.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No specific scope areas defined.</p>
        ) : (
          <div className="space-y-1.5">
            {scope.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={item}
                  onChange={(e) => handleItemChange(scope, setScope, idx, e.target.value)}
                  disabled={isReadOnly}
                  className="text-xs font-mono"
                  placeholder="e.g. app/api/healthz"
                />
                {!isReadOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveItem(scope, setScope, idx)}
                    className="h-8 w-8 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Acceptance Criteria List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-700">Acceptance Criteria</label>
          {!isReadOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleAddItem(acceptanceCriteria, setAcceptanceCriteria)}
              className="h-7 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Criterion
            </Button>
          )}
        </div>
        {acceptanceCriteria.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No acceptance criteria defined.</p>
        ) : (
          <div className="space-y-1.5">
            {acceptanceCriteria.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={item}
                  onChange={(e) =>
                    handleItemChange(acceptanceCriteria, setAcceptanceCriteria, idx, e.target.value)
                  }
                  disabled={isReadOnly}
                  className="text-xs"
                  placeholder="e.g. Endpoint returns status 200"
                />
                {!isReadOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      handleRemoveItem(acceptanceCriteria, setAcceptanceCriteria, idx)
                    }
                    className="h-8 w-8 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assumptions List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-700">Declared Assumptions</label>
          {!isReadOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleAddItem(assumptions, setAssumptions)}
              className="h-7 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Assumption
            </Button>
          )}
        </div>
        {assumptions.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No assumptions declared.</p>
        ) : (
          <div className="space-y-1.5">
            {assumptions.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={item}
                  onChange={(e) =>
                    handleItemChange(assumptions, setAssumptions, idx, e.target.value)
                  }
                  disabled={isReadOnly}
                  className="text-xs italic text-slate-600"
                  placeholder="e.g. Assuming standard JSON response format"
                />
                {!isReadOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveItem(assumptions, setAssumptions, idx)}
                    className="h-8 w-8 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-4 mt-6">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>

        <Button type="button" variant="success" size="sm" onClick={handleConfirm}>
          <Check className="h-4 w-4 mr-1" /> Confirm & Save
        </Button>
      </div>
    </div>
  );
}
