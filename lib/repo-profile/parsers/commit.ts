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
  const ticketRegex = /^([A-Z]+-\d+)/;

  for (const msg of commitMessages) {
    if (conventionalRegex.test(msg)) {
      conventionalCount++;
    }

    const ticketMatch = msg.match(ticketRegex);
    if (ticketMatch) {
      ticketPrefixCount++;
      prefixes.add(ticketMatch[1].split('-')[0]);
    }
  }

  const threshold = Math.max(1, Math.floor(commitMessages.length * 0.3));

  return {
    conventional: conventionalCount >= threshold,
    ticketPrefix: ticketPrefixCount >= threshold,
    samplePrefixes: Array.from(prefixes).slice(0, 3)
  };
}
