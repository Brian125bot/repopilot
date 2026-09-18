import { parseSnippet, type Snippet } from '@/lib/types/steering';

const BUILTIN_STAMP = '2026-09-01T00:00:00.000Z';

const BUILTIN_SNIPPETS: readonly Snippet[] = [
  {
    id: 'builtin-run-tests',
    title: 'Run relevant tests',
    content: 'Run the repository test suite scoped to the files touched by this change and report pass/fail per file.',
    category: 'verification',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-verify-lint',
    title: 'Verify lint and types',
    content: 'Run the linter and type checker, then list every remaining error with its file and line number.',
    category: 'verification',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-explain-diff',
    title: 'Explain the diff',
    content: 'Explain what changed in the current diff file by file, and call out any scope that looks unintended.',
    category: 'investigation',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-explain-failure',
    title: 'Explain the failure',
    content: 'Explain the most likely root cause of the latest test or build failure and cite the failing output lines.',
    category: 'remediation',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
];

for (const snippet of BUILTIN_SNIPPETS) {
  parseSnippet(snippet);
}

export function getBuiltinSnippets(): Snippet[] {
  return BUILTIN_SNIPPETS.map((snippet) => Object.freeze({ ...snippet }));
}

export function isBuiltinSnippetId(id: string): boolean {
  return id.startsWith('builtin-');
}

export const BUILTIN_SNIPPET_IDS: readonly string[] = BUILTIN_SNIPPETS.map((snippet) => snippet.id);
