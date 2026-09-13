import { DiffFileSummary, DiffStats, SanitizedDiffResult } from '@/types';

/** Single diff context budget shared by the sanitizer and the model call. */
export const MAX_DIFF_CHAR_BUDGET = 90_000;
/** Guaranteed headroom per criterion-relevant file before shared allocation. */
export const RESERVED_CHARS_PER_COVERED_FILE = 4_000;
/** In-block marker appended when a file's hunks exceed its allocation. */
export const TRUNCATED_HUNK_MARKER =
  '@@ ... @@\n[... Remaining hunks truncated by RepoPilot diff budget ...]';
/** Omission marker for files granted zero budget chars (header always kept). */
export const omittedFileMarker = (filename: string): string =>
  `[File omitted by RepoPilot diff budget: ${filename}]`;

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

export function globToRegex(glob: string): RegExp {
  const cleanGlob = glob.replace(/^\.\//, '').replace(/^[ab]\//, '').trim();

  let regexStr = '^';
  let i = 0;
  const len = cleanGlob.length;

  while (i < len) {
    const c = cleanGlob[i];

    if (c === '/') {
      // Check for /**/
      if (cleanGlob.slice(i, i + 4) === '/**/') {
        regexStr += '(?:/|/.+/)';
        i += 4;
        continue;
      }
      // Check for /** at the end
      if (cleanGlob.slice(i) === '/**') {
        regexStr += '(?:/.*)?';
        i += 3;
        continue;
      }
      regexStr += '/';
      i++;
    } else if (c === '*') {
      if (cleanGlob[i + 1] === '*') {
        // **/ at the beginning
        if (i === 0 && cleanGlob.slice(0, 3) === '**/') {
          regexStr += '(?:^|.*/)';
          i += 3;
          continue;
        }
        // Standalone **
        regexStr += '.*';
        i += 2;
      } else {
        // Single * matches anything except slash
        regexStr += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      regexStr += '[^/]';
      i++;
    } else if ('[.+^${}()|[\\]'.includes(c)) {
      regexStr += '\\' + c;
      i++;
    } else {
      regexStr += c;
      i++;
    }
  }

  regexStr += '$';
  return new RegExp(regexStr, 'i');
}

export function matchesFileBoundary(filepath: string, boundaries: string[]): boolean {
  if (!boundaries || boundaries.length === 0) return true;
  const cleanPath = filepath.replace(/^\.\//, '').replace(/^[ab]\//, '').trim();

  return boundaries.some((rawPattern) => {
    const pattern = rawPattern.trim().replace(/^\.\//, '').replace(/^[ab]\//, '');
    if (!pattern) return true;
    if (pattern === '*' || pattern === '**') return true;

    // Direct exact match
    if (cleanPath === pattern) {
      return true;
    }

    try {
      const reg = globToRegex(pattern);
      return reg.test(cleanPath);
    } catch {
      return false;
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

/**
 * Cut text to at most maxChars, preferring a hunk boundary (`@@`) when one
 * exists in the back half of the window so trailing hunks are never sliced
 * mid-hunk without a marker.
 */
export function cutAtHunkBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const idx = text.lastIndexOf('\n@@', maxChars);
  if (idx > maxChars * 0.5) return text.slice(0, idx);
  return text.slice(0, maxChars);
}

export function sanitizeUnifiedDiff(
  rawDiff: string,
  declaredBoundaries: string[] = [],
  maxCharacterLimit = MAX_DIFF_CHAR_BUDGET
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
        budgetChars: maxCharacterLimit,
        omittedFiles: [],
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

  // File-aware budget allocation against the single shared budget.
  // Phase 1 reserves headroom for criterion-relevant (in-scope) files first;
  // Phase 2 fills leftovers largest-first; files granted zero chars keep their
  // `diff --git` header plus an omission marker (never dropped silently).
  // Output preserves original file order; only the allocation is prioritized.
  const chunkTexts = includedChunks.map((c) => c.lines.join('\n'));
  const fullLength = chunkTexts.reduce((sum, t) => sum + t.length + 2, 0);
  let combinedDiff = chunkTexts.join('\n\n');
  let isTruncated = false;
  let truncationNotice: string | undefined = undefined;
  const omittedFiles: string[] = [];

  if (fullLength > maxCharacterLimit) {
    isTruncated = true;
    const granted = new Array<number>(includedChunks.length).fill(0);
    let remaining = maxCharacterLimit;

    const grant = (index: number, chars: number): void => {
      const take = Math.max(0, Math.min(chars, remaining));
      granted[index] += take;
      remaining -= take;
    };

    // Phase 1: reserved quota for criterion-relevant files, original order.
    includedChunks.forEach((chunk, index) => {
      if (!chunk.isAuthorized || remaining <= 0) return;
      grant(index, Math.min(RESERVED_CHARS_PER_COVERED_FILE, chunkTexts[index].length));
    });

    // Phase 2: remaining budget to the largest leftovers first.
    const leftovers = includedChunks
      .map((chunk, index) => ({ index, left: chunkTexts[index].length - granted[index] }))
      .filter((item) => item.left > 0)
      .sort((a, b) => b.left - a.left);
    for (const item of leftovers) {
      if (remaining <= 0) break;
      grant(item.index, item.left);
    }

    const renderedParts: string[] = [];
    includedChunks.forEach((chunk, index) => {
      const text = chunkTexts[index];
      const allowed = granted[index];
      if (allowed <= 0) {
        omittedFiles.push(chunk.filename);
        const headerLine = chunk.lines[0] || `diff --git a/${chunk.filename} b/${chunk.filename}`;
        renderedParts.push(`${headerLine}\n${omittedFileMarker(chunk.filename)}`);
        return;
      }
      if (text.length <= allowed) {
        renderedParts.push(text);
        return;
      }
      renderedParts.push(`${cutAtHunkBoundary(text, allowed)}\n${TRUNCATED_HUNK_MARKER}`);
    });

    combinedDiff = renderedParts.join('\n\n');
    truncationNotice = `Large diff detected (${rawDiff.length.toLocaleString()} chars). Per-file budget truncated within the shared ${maxCharacterLimit.toLocaleString()}-char limit; ${omittedFiles.length} file(s) omitted with headers preserved.`;
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
    budgetChars: maxCharacterLimit,
    omittedFiles,
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
