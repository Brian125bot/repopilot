'use client';

import * as React from 'react';
import { AlertTriangle, ArrowLeft, Check, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { GOAL_UNCLEAR_TITLE, type GoalExtracted } from '@/lib/goals/types';

export interface GoalExtractedEditorProps {
  extracted: GoalExtracted;
  rawText: string;
  onConfirm: (edited: GoalExtracted) => void;
  onBack: () => void;
  isSaving: boolean;
  saveError?: string | null;
  confirmLabel?: string;
}

function normalizeList(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

interface EditableListProps {
  legend: string;
  items: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
  placeholder: string;
  emptyHint: string;
  disabled?: boolean;
  monospace?: boolean;
}

function EditableList({
  legend,
  items,
  onChange,
  addLabel,
  placeholder,
  emptyHint,
  disabled,
  monospace,
}: EditableListProps) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <div className="flex items-center justify-between gap-2">
        <legend className="text-xs font-semibold text-slate-700">{legend}</legend>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange([...items, ''])}
          className="h-6 px-2 text-[11px] text-indigo-600 hover:bg-indigo-50"
        >
          <Plus className="h-3 w-3" />
          {addLabel}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-[11px] italic text-slate-400">{emptyHint}</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <Input
                value={item}
                placeholder={placeholder}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = e.target.value;
                  onChange(next);
                }}
                className={monospace ? 'font-mono text-[11px]' : 'text-xs'}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${legend} line ${index + 1}`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="h-8 w-8 shrink-0 text-slate-400 hover:text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/**
 * COR-56 step 2 — the operator reviews, edits, and explicitly approves the
 * extracted goal. Ambiguity flags raised by the extractor are shown as
 * warnings and cannot be dismissed here; the operator has to resolve the goal
 * in the fields below before Confirm unlocks.
 */
export function GoalExtractedEditor({
  extracted,
  rawText,
  onConfirm,
  onBack,
  isSaving,
  saveError,
  confirmLabel = 'Confirm & Continue',
}: GoalExtractedEditorProps) {
  const [title, setTitle] = React.useState(extracted.title);
  const [scope, setScope] = React.useState<string[]>([...extracted.scope]);
  const [acceptanceCriteria, setAcceptanceCriteria] = React.useState<string[]>([
    ...extracted.acceptanceCriteria,
  ]);
  const [assumptions, setAssumptions] = React.useState<string[]>([...extracted.assumptions]);
  const ambiguityFlags = extracted.ambiguityFlags;

  const trimmedCriteria = normalizeList(acceptanceCriteria);
  const isUnclear = title.trim() === GOAL_UNCLEAR_TITLE;
  const hasTitle = title.trim().length > 0;
  const hasCriteria = trimmedCriteria.length > 0;

  // Operator-in-the-loop: an unresolved or empty goal is never confirmable.
  const blockedReason = !hasTitle
    ? 'Enter a goal title before confirming.'
    : isUnclear
      ? `The extractor marked this goal ${GOAL_UNCLEAR_TITLE}. Replace the title with what you actually want, then confirm.`
      : !hasCriteria
        ? 'Add at least one verifiable acceptance criterion before confirming.'
        : null;

  const handleConfirm = () => {
    if (blockedReason) return;
    onConfirm({
      title: title.trim(),
      scope: normalizeList(scope),
      acceptanceCriteria: trimmedCriteria,
      assumptions: normalizeList(assumptions),
      ambiguityFlags,
    });
  };

  return (
    <div className="space-y-5">
      {isUnclear && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Gemini could not read an actionable goal</AlertTitle>
          <AlertDescription className="text-xs">
            Review the operator text below and write the goal yourself. Confirm stays locked until the
            title is real.
          </AlertDescription>
        </Alert>
      )}

      {ambiguityFlags.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {ambiguityFlags.length} ambiguity flag{ambiguityFlags.length === 1 ? '' : 's'} raised
          </AlertTitle>
          <AlertDescription className="text-xs">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {ambiguityFlags.map((flag, index) => (
                <li key={index}>{flag}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">
          Operator text (always preserved)
        </summary>
        <p className="mt-1.5 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-600">
          {rawText}
        </p>
      </details>

      {saveError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Goal was not saved</AlertTitle>
          <AlertDescription className="text-xs">{saveError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <label htmlFor="goal-title" className="block text-xs font-semibold text-slate-700">
          Title
        </label>
        <Input
          id="goal-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-xs font-semibold"
        />
      </div>

      <EditableList
        legend="Scope (files and components expected to change)"
        items={scope}
        onChange={setScope}
        addLabel="Add scope"
        placeholder="lib/goals/storage.ts"
        emptyHint="No scope recorded."
        monospace
        disabled={isSaving}
      />

      <EditableList
        legend="Acceptance criteria (verifiable — how is each one checked?)"
        items={acceptanceCriteria}
        onChange={setAcceptanceCriteria}
        addLabel="Add criterion"
        placeholder="npm test lib/goals/storage.test.ts passes with the new roundtrip case"
        emptyHint="No acceptance criteria yet."
        disabled={isSaving}
      />

      <EditableList
        legend="Assumptions (defaults you inferred)"
        items={assumptions}
        onChange={setAssumptions}
        addLabel="Add assumption"
        placeholder="No new runtime dependencies"
        emptyHint="No assumptions recorded."
        disabled={isSaving}
      />

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="outline" size="sm" onClick={onBack} disabled={isSaving}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>

        <div className="flex flex-col items-end gap-1.5">
          {blockedReason && (
            <p className="text-[11px] text-amber-700" role="status">
              {blockedReason}
            </p>
          )}
          <Button
            type="button"
            variant="success"
            size="sm"
            onClick={handleConfirm}
            disabled={Boolean(blockedReason) || isSaving}
            className="text-xs font-semibold"
          >
            {isSaving ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Saving to vault…
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                {confirmLabel}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}