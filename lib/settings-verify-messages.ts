export const GEMINI_EMPTY_MODELS_MESSAGE =
  'Key accepted but no models returned — confirm the Generative Language API is enabled.';

export function julesNotConnectedMessage(repo: string): string {
  return `Jules works, but ${repo} isn't connected. Visit jules.google.com to add it.`;
}

export type GitHubTokenType = 'classic' | 'fine-grained' | 'unknown';

const BROAD_SCOPES = new Set(['repo', 'delete_repo', 'workflow']);
export const CLASSIC_PAT_WARNING =
  'Classic PAT with broad scopes detected — fine-grained is recommended.';
export const FINE_GRAINED_ACCESS_WARNING =
  "Token can't read the repo. Check fine-grained PAT resource access.";

export function classifyGitHubToken(
  oauthScopesHeader: string | null,
  tokenTypeHeader: string | null
): { tokenType: GitHubTokenType; scopes: string[] } {
  const scopes = (oauthScopesHeader || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (scopes.length > 0) return { tokenType: 'classic', scopes };
  if ((tokenTypeHeader || '').toLowerCase().includes('fine-grained')) {
    return { tokenType: 'fine-grained', scopes: [] };
  }
  return { tokenType: 'fine-grained', scopes: [] };
}

export function classicScopeWarnings(scopes: string[]): string[] {
  const broad = scopes.filter((s) => BROAD_SCOPES.has(s) || s.startsWith('admin:'));
  return broad.length > 0 ? [CLASSIC_PAT_WARNING] : [];
}
