import { ConventionEntry } from '@/lib/types/steering';

export interface GitHubCommitItem {
  sha?: string;
  commit?: {
    message?: string;
    author?: {
      name?: string;
      date?: string;
    };
  };
}

export function parseCommitMessages(commits: GitHubCommitItem[]): ConventionEntry[] {
  const conventions: ConventionEntry[] = [];
  if (!Array.isArray(commits) || commits.length === 0) return conventions;

  const messages = commits
    .map((c) => c.commit?.message?.trim() || '')
    .filter(Boolean);

  if (messages.length === 0) return conventions;

  // Check for conventional commit style
  const conventionalRegex = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9_.-]+\))?!?:/i;
  const conventionalCount = messages.filter((m) => conventionalRegex.test(m)).length;

  if (conventionalCount > 0 && conventionalCount / messages.length >= 0.3) {
    conventions.push({
      id: 'conv-commit-style',
      title: 'Conventional Commit Style',
      body: `Repository uses Conventional Commits format (e.g., feat(scope): message). Observed in ${conventionalCount}/${messages.length} recent commits.`,
      source: 'commit-history',
    });
  }

  // Check for issue reference patterns e.g. #123, COR-123, LIN-123
  const issueRefRegex = /(#\d+|[A-Z]{2,10}-\d+)/;
  const issueRefCount = messages.filter((m) => issueRefRegex.test(m)).length;

  if (issueRefCount > 0 && issueRefCount / messages.length >= 0.2) {
    conventions.push({
      id: 'conv-issue-refs',
      title: 'Issue Tracker References',
      body: `Commits frequently reference issue tracker keys (e.g., #123 or KEY-123). Observed in ${issueRefCount}/${messages.length} recent commits.`,
      source: 'commit-history',
    });
  }

  return conventions;
}
