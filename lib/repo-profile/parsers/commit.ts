export interface ParsedCommits {
  conventional: boolean;
  ticketPrefix: boolean;
  samplePrefixes: string[];
}

export function parseCommits(commitMessages: string[]): ParsedCommits {
  let conventionalCount = 0;
  let ticketPrefixCount = 0;
  const prefixes = new Set<string>();

  const conventionalRegex = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?: .+/i;
  // Match ticket key formats like "COR-54: ...", "[COR-54] ...", "feat(scope): ... (COR-54)", "feat(COR-54): ..."
  const ticketRegex = /([A-Z][A-Z0-9]+)-\d+/;

  for (const rawMsg of commitMessages) {
    if (!rawMsg) continue;
    // Evaluate first line only
    const msg = rawMsg.split(/\r?\n/)[0].trim();

    // Ignore merge commits
    if (/^Merge (pull request|branch)/i.test(msg)) {
      continue;
    }

    if (conventionalRegex.test(msg)) {
      conventionalCount++;
    }

    const ticketMatch = msg.match(ticketRegex);
    if (ticketMatch) {
      ticketPrefixCount++;
      // Capture project key (e.g. "COR" from "COR-54")
      prefixes.add(ticketMatch[1]);
    }
  }

  const threshold = Math.max(1, Math.floor(commitMessages.length * 0.3));

  return {
    conventional: conventionalCount >= threshold,
    ticketPrefix: ticketPrefixCount >= threshold,
    samplePrefixes: Array.from(prefixes).slice(0, 3)
  };
}
