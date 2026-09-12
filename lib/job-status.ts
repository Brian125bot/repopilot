import { Blueprint } from '@/types';

export type JobStatusLabel = 'idle' | 'watching' | 'PR ready' | 'last verdict';

/**
 * Derives the chrome label for the active blueprint.
 * lastBrief.verdict wins, then a harvested PR, then an in-flight session.
 */
export function deriveJobStatus(blueprint: Blueprint | null | undefined): JobStatusLabel {
  if (!blueprint) return 'idle';
  if (blueprint.lastBrief?.verdict) return 'last verdict';
  if (blueprint.prUrl && blueprint.prUrl.trim()) return 'PR ready';
  if (blueprint.sessionId && String(blueprint.sessionId).trim()) return 'watching';
  return 'idle';
}

export function jobStatusDetail(blueprint: Blueprint | null | undefined): string {
  const label = deriveJobStatus(blueprint);
  if (label === 'last verdict' && blueprint?.lastBrief?.verdict) {
    return blueprint.lastBrief.verdict;
  }
  if (label === 'PR ready' && blueprint?.prTitle) return blueprint.prTitle;
  if (label === 'watching' && blueprint?.sessionState) return blueprint.sessionState;
  return label;
}
