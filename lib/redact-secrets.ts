const TOKEN_PATTERNS: RegExp[] = [
  /\b(ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|gho_[A-Za-z0-9]+|ghu_[A-Za-z0-9]+|ghs_[A-Za-z0-9]+|ghr_[A-Za-z0-9]+)\b/g,
  /\bAIza[A-Za-z0-9\-_]{10,}\b/g,
  /\bAQ[.\-_A-Za-z0-9]{10,}\b/g,
  /\bya29[.\-_A-Za-z0-9]{10,}\b/g,
  /\beyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\b/g,
  /\b[0-9a-f]{20,}\b/gi,
  /\b[A-Za-z0-9\-_]{32,}\b/g,
];

export function redactSecrets(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  if (!text) return '';
  let redacted = text;
  for (const pattern of TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}
