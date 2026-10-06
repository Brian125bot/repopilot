'use client';

import { SnippetCard } from '@/components/JulesSession/SnippetCard';
import type { CitationReason } from '@/lib/snippets/citations';
import type { ScoredSnippet } from '@/lib/snippets/ranking';
import type { Snippet } from '@/lib/types/steering';

export interface SnippetBarProps {
  /**
   * Ranked suggestions, already capped at the top five by
   * the ranking engine (`rankSnippets`).
   */
  suggestions: ScoredSnippet[];
  /** "Why this?" citation explanations, keyed by snippet id. */
  citationsBySnippetId?: ReadonlyMap<string, CitationReason[]>;
  /** Selecting a card populates the ResponseEditor. */
  onSelect: (snippet: Snippet) => void;
  selectedSnippetId?: string | null;
}

/**
 * COR-59 snippet bar. Renders directly beneath the latest
 * Jules output in an active interactive session, above the
 * standard freeform input box.
 *
 * Empty state: when zero suggestions clear the ranking
 * thresholds — or the snippet list is empty — the bar
 * renders nothing at all (`null`), so only the standard
 * freeform input box is shown. No broken wrappers, no
 * empty cards.
 */
export function SnippetBar({
  suggestions,
  citationsBySnippetId,
  onSelect,
  selectedSnippetId,
}: SnippetBarProps) {
  if (suggestions.length === 0) return null;

  return (
    <section aria-label="Suggested responses" className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Suggested responses
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {suggestions.map(({ snippet }) => (
          <SnippetCard
            key={snippet.id}
            snippet={snippet}
            citations={citationsBySnippetId?.get(snippet.id) ?? []}
            isSelected={selectedSnippetId === snippet.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
