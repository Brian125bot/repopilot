'use client';

import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface ResponseEditorProps {
  /**
   * Current editor content. Controlled: the parent owns
   * the state, so a snippet selection replaces the
   * content and manual edits are preserved as-is until
   * the operator sends.
   */
  value: string;
  onChange: (value: string) => void;
  /**
   * Explicit send action. Invoked only by the Send button
   * below — never automatically, and never by selecting a
   * snippet card.
   */
  onSend: (value: string) => void;
  isSending?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * COR-59 edit-then-send editor for interactive Jules
 * turns.
 *
 * Operator-in-the-loop invariant: selecting a snippet
 * card only populates this editor (the parent replaces
 * `value`); the turn is dispatched exclusively by the
 * explicit Send button, which transmits exactly what is
 * on screen — including any manual edits the operator
 * made after the selection.
 */
export function ResponseEditor({
  value,
  onChange,
  onSend,
  isSending = false,
  disabled = false,
  placeholder = 'Reply to Jules…',
}: ResponseEditorProps) {
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !isSending && !disabled;

  return (
    <div className="space-y-2">
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled || isSending}
        rows={4}
        aria-label="Response to Jules"
        className="min-h-[96px] resize-y text-xs"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">
          {trimmed.length > 0
            ? 'Review the prompt above, then send it to Jules.'
            : 'Pick a suggested snippet or write a reply. Nothing sends until you click Send.'}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => onSend(value)}
          disabled={!canSend}
          className="shrink-0 text-xs gap-1.5"
        >
          <Send className="h-3.5 w-3.5" />
          {isSending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
