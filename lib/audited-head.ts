import { parseGitHubPRUrl } from '@/lib/github';

export async function verifyAuditedHead(input: {
  repo?: string;
  prUrl?: string;
  prNumber?: number | string;
  auditedHeadSha: string;
  githubPat?: string | null;
}): Promise<{ ok: true; currentHeadSha: string } | { ok: false; status: number; error: string }> {
  const parsed = input.prUrl ? parseGitHubPRUrl(input.prUrl) : null;
  const [repoOwner, repoName] = (input.repo || '').split('/');
  const owner = parsed?.owner || repoOwner;
  const repo = parsed?.repo || repoName;
  const pullNumber = parsed?.pullNumber || Number(input.prNumber);

  if (!owner || !repo || !pullNumber) {
    return { ok: false, status: 400, error: 'Remediation requires a valid GitHub PR reference.' };
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'RepoPilot-AuditEngine',
  };
  const token = input.githubPat?.trim();
  if (token) headers.Authorization = `token ${token}`;

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`, {
      headers,
      cache: 'no-store',
    });
    if (!response.ok) {
      return { ok: false, status: 502, error: `Failed to verify the current GitHub PR head (HTTP ${response.status}).` };
    }
    const data = await response.json();
    const currentHeadSha = typeof data?.head?.sha === 'string' ? data.head.sha.trim() : '';
    if (!currentHeadSha || currentHeadSha !== input.auditedHeadSha.trim()) {
      return { ok: false, status: 409, error: 'Head moved since audit — re-evaluate.' };
    }
    return { ok: true, currentHeadSha };
  } catch {
    return { ok: false, status: 502, error: 'Failed to verify the current GitHub PR head.' };
  }
}
