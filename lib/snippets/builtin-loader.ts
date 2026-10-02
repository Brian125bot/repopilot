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
  {
    id: 'builtin-verify-security-scan',
    title: 'Verify with the dependency security scan',
    content:
      'Run the repository dependency security audit and report each finding with its severity and the file it comes from.',
    category: 'verification',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-verify-build',
    title: 'Verify the production build',
    content:
      'Run the production build and report the first failing step with the relevant build output lines.',
    category: 'verification',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-verify-config-diff',
    title: 'Check the change for environment config',
    content:
      'Check whether this change alters CI, deployment, or environment configuration, and list every affected file.',
    category: 'verification',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-map-change-surface',
    title: 'Map the change surface',
    content:
      'List every module, route, and stored record this change could touch, and say why each one is in scope.',
    category: 'investigation',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-trace-data-flow',
    title: 'Trace the data flow',
    content:
      'Trace how the changed value reaches each consumer and name every hop between the change and its effect.',
    category: 'investigation',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-locate-conventions',
    title: 'Locate the conventions this change must follow',
    content:
      'Identify the repository conventions this change is subject to and cite the file that states each one.',
    category: 'investigation',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-check-callers',
    title: 'Find the callers of the changed symbol',
    content:
      'Find every caller of the changed symbol or export and state for each whether it needs updating.',
    category: 'investigation',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-propose-minimal-fix',
    title: 'Propose the smallest fix',
    content:
      'Propose the smallest change that addresses the failure, and state the trade-off each rejected alternative makes.',
    category: 'remediation',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-draft-revert',
    title: 'Draft a revert of the offending change',
    content:
      'Draft a revert of the change that introduced this failure, scoped to the smallest commit that causes it.',
    category: 'remediation',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-repair-test-fixture',
    title: 'Repair the failing test fixture',
    content:
      'Repair the failing test fixture so it asserts the intended behaviour, and say which assertion was wrong.',
    category: 'remediation',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-split-change',
    title: 'Split the change into reviewable units',
    content:
      'Split this change into units that can be reviewed separately, ordered by their dependency on each other.',
    category: 'remediation',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-summarise-change',
    title: 'Summarise the change for a reviewer',
    content:
      'Summarise what this change does in five lines or fewer, without restating the diff.',
    category: 'general',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-write-release-note',
    title: 'Draft a release note entry',
    content:
      'Draft a changelog entry describing the user-visible effect of this change, and nothing an operator would not notice.',
    category: 'general',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-write-pr-description',
    title: 'Draft a pull request description',
    content:
      'Draft a pull request description covering what changed, why, and how it was verified.',
    category: 'general',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-clarify-request',
    title: 'Restate the request as acceptance criteria',
    content:
      'Restate the request as explicit acceptance criteria, and list what in it is still ambiguous.',
    category: 'general',
    isBuiltin: true,
    isPinned: false,
    usageCount: 0,
    createdAt: BUILTIN_STAMP,
    updatedAt: BUILTIN_STAMP,
  },
  {
    id: 'builtin-describe-rollback',
    title: 'Describe how to roll the change back',
    content:
      'Describe how to roll this change back, and name any stored data it would leave behind.',
    category: 'general',
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
