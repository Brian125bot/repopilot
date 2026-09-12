import { Blueprint } from '@/types';
import { normalizeRepoSlug } from '@/lib/jules';
import { parseGitHubPRUrl } from '@/lib/github';

export interface Stage2Prefill {
  prInput: string;
  /** Auto-fetch only when a real PR URL is already known. */
  autoFetchPrUrl: string | null;
  waitingForPr: boolean;
  waitingMessage?: string;
  repo?: string;
  headBranch?: string;
}

export function stage2Prefill(blueprint: Blueprint | null): Stage2Prefill {
  if (!blueprint) {
    return { prInput: '', autoFetchPrUrl: null, waitingForPr: false };
  }

  if (blueprint.prUrl && blueprint.prUrl.trim()) {
    return {
      prInput: blueprint.prUrl.trim(),
      autoFetchPrUrl: blueprint.prUrl.trim(),
      waitingForPr: false,
      repo: blueprint.repo,
      headBranch: blueprint.branchName,
    };
  }

  const waitingForPr = Boolean(blueprint.sessionId) && !blueprint.prUrl;
  const branch = blueprint.branchName || '';
  const repo = blueprint.repo || '';
  const waitingMessage = waitingForPr
    ? `Jules has not opened a PR yet on \`${branch || 'the target branch'}\`.${
        blueprint.sessionState ? ` Session state: ${blueprint.sessionState}.` : ''
      }`
    : repo && branch
      ? `No pull request harvested. Look up an open PR on ${repo} branch ${branch}.`
      : undefined;

  return {
    prInput: '',
    autoFetchPrUrl: null,
    waitingForPr,
    waitingMessage,
    repo: repo || undefined,
    headBranch: branch || undefined,
  };
}

export function matchVaultBlueprint(
  blueprints: Blueprint[],
  opts: {
    prUrl?: string;
    repo?: string;
    headBranch?: string;
    activeId?: string;
  }
): Blueprint | undefined {
  if (!Array.isArray(blueprints) || blueprints.length === 0) return undefined;

  if (opts.activeId) {
    const byId = blueprints.find((b) => b.blueprintId === opts.activeId);
    if (byId) return byId;
  }

  if (opts.prUrl) {
    const exactPr = blueprints.find((b) => b.prUrl && b.prUrl === opts.prUrl);
    if (exactPr) return exactPr;
  }

  const parsed = opts.prUrl ? parseGitHubPRUrl(opts.prUrl) : null;
  const repoSlug = normalizeRepoSlug(opts.repo || (parsed ? `${parsed.owner}/${parsed.repo}` : '') || '');
  const head = (opts.headBranch || '').trim().toLowerCase();
  if (!repoSlug) return undefined;

  const repoMatches = blueprints.filter((b) => normalizeRepoSlug(b.repo || '') === repoSlug);
  if (head) {
    const branchHit = repoMatches.find((b) => (b.branchName || '').trim().toLowerCase() === head);
    if (branchHit) return branchHit;
  }
  return repoMatches[0];
}
