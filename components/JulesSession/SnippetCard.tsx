'use client';

import * as React from 'react';
import { HelpCircle, Quote } from 'lucide-react';
import { badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CitationReason } from '@/lib/snippets/citations';
import type { Snippet, SnippetCategory } from '@/lib/types/steering';

/** How much of the snippet content the card preview shows. */
const PREVIEW_MAX_CHARS = 140;

const CATEGORY_BADGE_VARIANT: Record<
  SnippetCategory,
  'secondary' | 'success' | 'warning' | 'indigo'
> = {
  investigation: 'indigo',
  verification: 'success',
  remediation: 'warning',
  general: 'secondary',
};

export interface SnippetCardProps {
  snippet: Snippet;
  /** "Why this?" citation explanations for the tooltip. */
  citations: CitationReason[];
  /**
   * Selecting a snippet hands it to the ResponseEditor for
   * review and editing. It never sends anything by itself.
   */
  onSelect: (snippet: Snippet) => void;
  isSelected?: boolean;
}

function preview(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= PREVIEW_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
}

/**
 * COR-59 snippet card: category badge, title, content
 * preview, and a "Why this?" citation popover. The whole
 * card is the select control — clicking it populates the
 * ResponseEditor; the citation trigger is a separate
 * sibling so the two actions never nest.
 */
export function SnippetCard({
  snippet,
  citations,
  onSelect,
  isSelected = false,
}: SnippetCardProps) {
  const [whyOpen, setWhyOpen] = React.useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onSelect(snippet)}
        aria-pressed={isSelected}
        className={`block w-full rounded-xl border p-3 text-left transition-colors ${
          isSelected
            ? 'border-indigo-500 bg-indigo-50/60'
            : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30'
        }`}
      >
        {/* Phrasing content only (span, not div/p) so the
            card stays a valid native button. */}
        <span
          className={cn(
            badgeVariants({
              variant: CATEGORY_BADGE_VARIANT[snippet.category],
            }),
            'text-[10px]'
          )}
        >
          {snippet.category}
        </span>
        <span className="mt-1.5 block text-xs font-semibold text-slate-800">
          {snippet.title}
        </span>
        <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
          {preview(snippet.content)}
        </span>
      </button>

      {citations.length > 0 && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Why this snippet is suggested: ${snippet.title}`}
            aria-expanded={whyOpen}
            onClick={() => setWhyOpen((open) => !open)}
            className="absolute right-1.5 top-1.5 h-6 w-6 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </Button>
          {whyOpen && (
            <div
              role="tooltip"
              className="absolute right-0 top-8 z-10 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
            >
              <p className="text-[11px] font-semibold text-slate-700">
                Why this?
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {citations.map((citation) => (
                  <li
                    key={`${citation.kind}-${citation.text}`}
                    className="flex gap-1.5 text-[11px] leading-snug text-slate-600"
                  >
                    <Quote className="mt-0.5 h-3 w-3 shrink-0 text-indigo-400" />
                    <span>{citation.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
