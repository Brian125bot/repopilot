import type { AcceptanceCriterion } from '@/types';
import type { GoalExtracted } from '@/lib/goals/types';

/**
 * COR-56: bridges the operator-confirmed goal onto the Stage 1 criteria matrix.
 *
 * The contract Jules receives is built from `criteria`, and Stage 2 audits the
 * same matrix, so a confirmed goal has to land here to be scored. Categories are
 * inferred from the criterion text because `GoalExtracted` carries no category;
 * a `testing` row is what `lintCriteria` looks for when it balances the matrix.
 */
const TEST_HINT = /\btests?\b|\bcoverage\b|\bspec\b/i;

export function criteriaFromGoalExtracted(extracted: GoalExtracted | null): AcceptanceCriterion[] {
  if (!extracted) return [];
  return extracted.acceptanceCriteria
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: String(index + 1),
      text,
      category: TEST_HINT.test(text) ? ('testing' as const) : ('functional' as const),
    }));
}