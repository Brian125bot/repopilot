export interface ParsedCommits {
  conventional: boolean;
  ticketPrefix: boolean;
  samplePrefixes: string[];
}

// A ticket key is a short uppercase project code ("COR", "ABC1", "PROJ") followed
// by a number. Requiring an uppercase code is not enough on its own: bare patterns
// like /[A-Z]+-\d+/ also match "SHA-256", "UTF-8" and "ISO-8601". Two guards narrow
// it down:
//
//   1. Position. A ticket is only recognised in an anchored slot - the start of the
//      subject, a leading bracket, a conventional-commit scope, or a trailing
//      parenthetical. A standards name buried mid-sentence is not a ticket.
//   2. Denylist. Even in an anchored slot, well-known standard prefixes are refused,
//      so "UTF-8: ..." is not read as a ticket.
const TICKET_KEY = "[A-Z][A-Z0-9]{1,9}";
const TICKET_PATTERNS = [
  // "COR-54: harden the scan pipeline"
  new RegExp(`^(${TICKET_KEY})-\\d+:`),
  // "[COR-54] harden the scan pipeline"
  new RegExp(`^\\[(${TICKET_KEY})-\\d+\\]`),
  // "feat(COR-54): ..." or "feat(scope, COR-54): ..."
  new RegExp(`^[a-z][a-z0-9]*(?:\\([^)]*?\\b(${TICKET_KEY})-\\d+\\b[^)]*\\))?!?:`, "i"),
  // "fix: resolved bug (COR-54)" - key must sit immediately before the closing paren
  new RegExp(`\\b(${TICKET_KEY})-\\d+\\)\\s*$`),
];

const STANDARD_PREFIXES = new Set([
  "SHA", "MD5", "HMAC", "AES", "RSA",
  "UTF", "ASCII", "ANSI", "ISO", "IEC", "IEEE", "RFC",
  "HTTP", "HTTPS", "TLS", "SSL", "DNS", "TCP", "UDP", "IP",
  "MIME", "UUID", "JSON", "YAML", "TOML", "SQL", "URL", "URI", "HTML", "XML", "CSS",
]);

const CONVENTIONAL_REGEX =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?: .+/i;

const MERGE_COMMIT_REGEX = /^Merge (pull request|branch)/i;

/** Returns the ticket key when the subject carries one in an anchored slot, else null. */
export function extractTicketKey(subject: string): string | null {
  for (const pattern of TICKET_PATTERNS) {
    const match = subject.match(pattern);
    if (!match) continue;
    const key = match[1];
    if (!key || STANDARD_PREFIXES.has(key)) continue;
    return key;
  }
  return null;
}

export function parseCommits(commitMessages: string[]): ParsedCommits {
  let conventionalCount = 0;
  let ticketPrefixCount = 0;
  let evaluated = 0;
  const prefixes = new Set<string>();

  for (const rawMsg of commitMessages) {
    if (!rawMsg) continue;
    // Evaluate first line only
    const msg = rawMsg.split(/\r?\n/)[0].trim();
    if (!msg) continue;

    // Skipped merge commits must not count toward the threshold denominator,
    // otherwise a merge-heavy repository can never reach a convention.
    if (MERGE_COMMIT_REGEX.test(msg)) continue;

    evaluated++;

    if (CONVENTIONAL_REGEX.test(msg)) {
      conventionalCount++;
    }

    const ticketKey = extractTicketKey(msg);
    if (ticketKey) {
      ticketPrefixCount++;
      prefixes.add(ticketKey);
    }
  }

  if (evaluated === 0) {
    return { conventional: false, ticketPrefix: false, samplePrefixes: [] };
  }

  const threshold = Math.max(1, Math.floor(evaluated * 0.3));

  return {
    conventional: conventionalCount >= threshold,
    ticketPrefix: ticketPrefixCount >= threshold,
    samplePrefixes: Array.from(prefixes).slice(0, 3)
  };
}
