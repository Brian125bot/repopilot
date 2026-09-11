import { DiffFileSummary, DiffStats, SanitizedDiffResult } from '@/types';

// Blacklisted patterns for diff evaluation
const EXCLUDED_PATTERNS: { regex: RegExp; reason: string }[] = [
  { regex: /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$/i, reason: 'Lockfile (Dependency freeze)' },
  { regex: /\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|zip|tar|gz|woff|woff2|ttf|eot)$/i, reason: 'Binary or media asset' },
  { regex: /(^|\/)(dist|build|\.next|out|coverage|\.turbo|\.vercel)\//i, reason: 'Generated build artifacts' },
  { regex: /\.(min\.js|min\.css|map|wasm)$/i, reason: 'Minified code or sourcemap' },
  { regex: /(^|\/)\.git\//i, reason: 'Git internal metadata' },
];

export function isFileExcluded(filename: string): { isExcluded: boolean; reason?: string } {
  const cleanPath = filename.replace(/^[ab]\//, '');
  for (const item of EXCLUDED_PATTERNS) {
    if (item.regex.test(cleanPath)) {
      return { isExcluded: true, reason: item.reason };
    }
  }
  return { isExcluded: false };
}

export function matchesFileBoundary(filepath: string, boundaries: string[]): boolean {
  if (!boundaries || boundaries.length === 0) return true;
  const cleanPath = filepath.replace(/^[ab]\//, '').trim();

  return boundaries.some((rawPattern) => {
    const pattern = rawPattern.trim().replace(/^[ab]\//, '');
    if (!pattern) return true;
    if (pattern === '*' || pattern === '**') return true;

    // Direct match or exact subpath match
    if (cleanPath === pattern || cleanPath.startsWith(pattern.replace(/\*+$/, ''))) {
      return true;
    }

    // Convert glob pattern to regex
    // Escaping special characters except *
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '§DOUBLESTAR§')
      .replace(/\*/g, '[^/]*')
      .replace(/§DOUBLESTAR§/g, '.*');

    try {
      const reg = new RegExp(`^${escaped}$`, 'i');
      return reg.test(cleanPath);
    } catch {
      return cleanPath.includes(pattern);
    }
  });
}

interface ParsedFileChunk {
  header: string;
  filename: string;
  lines: string[];
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';
  isExcluded: boolean;
  exclusionReason?: string;
  isAuthorized: boolean;
}

export function sanitizeUnifiedDiff(
  rawDiff: string,
  declaredBoundaries: string[] = [],
  maxCharacterLimit = 100000
): SanitizedDiffResult {
  if (!rawDiff || rawDiff.trim().length === 0) {
    return {
      sanitizedDiff: '',
      rawDiffLength: 0,
      sanitizedDiffLength: 0,
      isTruncated: false,
      files: [],
      stats: {
        totalFilesTouched: 0,
        sanitizedFilesCount: 0,
        linesAdded: 0,
        linesRemoved: 0,
        touchedPaths: [],
        unauthorizedPaths: [],
      },
    };
  }

  // Split unified diff by `diff --git `
  const fileBlocks = rawDiff.split(/(?=diff --git )/g);
  const parsedChunks: ParsedFileChunk[] = [];
  const touchedPaths: string[] = [];
  const unauthorizedPaths: string[] = [];

  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const block of fileBlocks) {
    if (!block.trim()) continue;

    // Extract filename from block
    // Examples:
    // diff --git a/src/index.ts b/src/index.ts
    // +++ b/src/index.ts
    // rename to src/new.ts
    const gitDiffMatch = block.match(/diff --git a\/(.+?) b\/(.+?)(\r?\n|$)/);
    let filename = '';
    let status: 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown' = 'modified';

    if (gitDiffMatch) {
      filename = gitDiffMatch[2] || gitDiffMatch[1];
    } else {
      const plusPlusMatch = block.match(/\+\+\+ [ab]\/(.+?)(\r?\n|$)/);
      if (plusPlusMatch) {
        filename = plusPlusMatch[1];
      } else {
        const minusMinusMatch = block.match(/--- [ab]\/(.+?)(\r?\n|$)/);
        if (minusMinusMatch) {
          filename = minusMinusMatch[1];
        }
      }
    }

    if (!filename) {
      filename = 'unknown_file';
    }

    if (block.includes('new file mode')) {
      status = 'added';
    } else if (block.includes('deleted file mode')) {
      status = 'deleted';
    } else if (block.includes('rename to ')) {
      status = 'renamed';
    }

    // Count additions / deletions in this block
    const lines = block.split(/\r?\n/);
    let blockAdditions = 0;
    let blockDeletions = 0;

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        blockAdditions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        blockDeletions++;
      }
    }

    totalAdditions += blockAdditions;
    totalDeletions += blockDeletions;

    touchedPaths.push(filename);

    const { isExcluded, reason } = isFileExcluded(filename);
    const isAuthorized = matchesFileBoundary(filename, declaredBoundaries);

    if (!isAuthorized && declaredBoundaries.length > 0) {
      unauthorizedPaths.push(filename);
    }

    parsedChunks.push({
      header: lines.slice(0, 4).join('\n'),
      filename,
      lines,
      additions: blockAdditions,
      deletions: blockDeletions,
      status,
      isExcluded,
      exclusionReason: reason,
      isAuthorized,
    });
  }

  // Filter out excluded files for evaluation diff
  const includedChunks = parsedChunks.filter((chunk) => !chunk.isExcluded);

  // Check character limits and prioritize code files over doc/markdown/css if exceeding
  let combinedDiff = includedChunks.map((c) => c.lines.join('\n')).join('\n\n');
  let isTruncated = false;
  let truncationNotice: string | undefined = undefined;

  if (combinedDiff.length > maxCharacterLimit) {
    isTruncated = true;
    // Step 1: Remove markdown, css, text, yaml from diff first
    const codePriorityChunks = [...includedChunks].sort((a, b) => {
      const aIsDoc = /\.(md|markdown|txt|css|scss|yaml|yml|json)$/i.test(a.filename) ? 1 : 0;
      const bIsDoc = /\.(md|markdown|txt|css|scss|yaml|yml|json)$/i.test(b.filename) ? 1 : 0;
      return aIsDoc - bIsDoc;
    });

    const truncatedDiffParts: string[] = [];
    let currentLen = 0;

    for (const chunk of codePriorityChunks) {
      const chunkText = chunk.lines.join('\n');
      if (currentLen + chunkText.length <= maxCharacterLimit) {
        truncatedDiffParts.push(chunkText);
        currentLen += chunkText.length;
      } else {
        const remainingChars = maxCharacterLimit - currentLen;
        if (remainingChars > 500) {
          truncatedDiffParts.push(
            chunkText.slice(0, remainingChars) +
              `\n\n[... Remaining diff truncated for ${chunk.filename} due to size limits ...]`
          );
        }
        break;
      }
    }

    combinedDiff = truncatedDiffParts.join('\n\n');
    truncationNotice = `Large diff detected (${rawDiff.length.toLocaleString()} chars). Non-critical documentation and ancillary diffs were truncated to ensure precise LLM audit within safe token limits.`;
  }

  const fileSummaries: DiffFileSummary[] = parsedChunks.map((c) => ({
    filename: c.filename,
    status: c.status,
    additions: c.additions,
    deletions: c.deletions,
    changes: c.additions + c.deletions,
    isExcluded: c.isExcluded,
    exclusionReason: c.exclusionReason,
    isAuthorized: c.isAuthorized,
  }));

  const stats: DiffStats = {
    totalFilesTouched: touchedPaths.length,
    sanitizedFilesCount: includedChunks.length,
    linesAdded: totalAdditions,
    linesRemoved: totalDeletions,
    touchedPaths,
    unauthorizedPaths,
  };

  return {
    sanitizedDiff: combinedDiff,
    rawDiffLength: rawDiff.length,
    sanitizedDiffLength: combinedDiff.length,
    isTruncated,
    truncationNotice,
    files: fileSummaries,
    stats,
  };
}
