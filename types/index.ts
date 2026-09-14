export type CriterionCategory = 'functional' | 'security' | 'testing' | 'constraint';

export interface AcceptanceCriterion {
  id: string;
  text: string;
  category?: CriterionCategory;
  rationale?: string;
}

export interface RepoInspectionResult {
  repo: string;
  name: string;
  owner: string;
  description?: string;
  defaultBranch: string;
  primaryLanguage?: string;
  topics?: string[];
  treePreview?: string[];
  /** Recursive path list (up to ~150) for boundary validation + files-to-read. Falls back to root preview when truncated. */
  treePaths?: string[];
  /** True when treePaths is a full recursive listing vs root-only fallback. */
  treeTruncated?: boolean;
  keyFiles?: {
    hasPackageJson?: boolean;
    hasTsConfig?: boolean;
    hasDocker?: boolean;
    hasTests?: boolean;
    dependenciesSummary?: string[];
    readmeExcerpt?: string;
    /** npm scripts relevant to first-pass (test/lint/build) extracted from package.json. */
    scriptsSummary?: Record<string, string>;
    /** Detected test command Jules should run before opening the PR. */
    testCommand?: string;
    /** Detected framework (next/express/fastify/nest/unknown). */
    framework?: string;
    /** Detected package manager (npm/yarn/pnpm/bun). */
    packageManager?: string;
  };
  isReachable: boolean;
  visibility?: 'public' | 'private' | 'mock' | 'unknown';
  error?: string;
}

export interface GeneratedCriteriaResponse {
  criteria: AcceptanceCriterion[];
  recommendedFileBoundaries: string[];
  suggestedBranchName: string;
  summaryRationale: string;
  detectedArchitecture: string;
  /** Model-suggested globs rejected for matching zero real tree paths. */
  rejectedGlobs?: string[];
}

export interface Blueprint {
  blueprintId: string;
  repo: string;
  baseBranch: string;
  branchName: string;
  fileBoundaries: string[];
  objective: string;
  criteria: AcceptanceCriterion[];
  createdAt: string;
  sessionId?: string;
  compiledPrompt?: string;
  /** Jules source resource name this blueprint was dispatched against. */
  sourceName?: string;
  /** Canonical Jules web console URL for the session. */
  sessionUrl?: string;
  /** Last observed Jules session state (QUEUED, IN_PROGRESS, COMPLETED, ...). */
  sessionState?: string;
  /** Pull request harvested from the session once Jules opens one. */
  prUrl?: string;
  prTitle?: string;
  isRemediation?: boolean;
  /** Latest compact outcome brief for continuation (v0.3 outcome memory). */
  lastBrief?: FailureBrief;
  /** COR-40: PR head SHA locked at Evaluate time. Null when SHA was unavailable — remediation blocked. */
  auditedHeadSha?: string | null;
}

export type OutcomeTurn = 'initial' | 'continuation' | 'new-from-brief';

export interface FailureBrief {
  sessionId?: string;
  sessionState?: string;
  prUrl?: string;
  /** COR-40: audited PR head SHA carried from blueprint/report. Null blocks remediation. */
  auditedHeadSha?: string | null;
  verdict: 'READY_TO_MERGE' | 'NEEDS_REVISION' | 'BLOCKED';
  score: number;
  unmetIds: string[];
  partialIds: string[];
  metIds: string[];
  unauthorizedPaths: string[];
  doNotTouch: string[];
  requiredFixes: string[];
  evidenceById?: Record<string, string>;
  turn?: OutcomeTurn;
}

export interface DiffFileSummary {
  filename: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';
  additions: number;
  deletions: number;
  changes: number;
  isExcluded: boolean;
  exclusionReason?: string;
  isAuthorized: boolean;
}

export interface DiffStats {
  totalFilesTouched: number;
  sanitizedFilesCount: number;
  linesAdded: number;
  linesRemoved: number;
  touchedPaths: string[];
  unauthorizedPaths: string[];
  /** Diff budget applied during sanitization (chars). */
  budgetChars?: number;
  /** Files granted zero budget chars (header-only omission lines emitted). */
  omittedFiles?: string[];
}

export interface SanitizedDiffResult {
  sanitizedDiff: string;
  rawDiffLength: number;
  sanitizedDiffLength: number;
  isTruncated: boolean;
  truncationNotice?: string;
  files: DiffFileSummary[];
  stats: DiffStats;
}

export interface CriterionResult {
  id: string;
  criterion: string;
  status: 'MET' | 'PARTIALLY_MET' | 'UNMET';
  evidence: string;
  lineReferences: string[];
  /** Joined from the Stage 1 criterion id — not a model-authored field. */
  category?: CriterionCategory;
  /** What already holds (MET / PARTIAL). Optional so older reports still parse. */
  satisfiedAspects?: string;
  /** What is still missing (PARTIAL / UNMET). Optional so older reports still parse. */
  remainingWork?: string;
  /** Refs whose path token is absent from sanitizer touchedPaths. Never fails the audit — UI shows “cited, not in diff”. */
  unverifiedReferences?: string[];
}

export interface AuditDiffFacts {
  filesTouched: number;
  linesAdded: number;
  linesRemoved: number;
  unauthorizedCount: number;
  /** True when the sanitizer truncated or the evaluate slice cut the diff sent to the model. */
  truncated?: boolean;
  /** Chars of diff text actually sent to the model (<= sanitized length). */
  shownChars?: number;
  /** Sanitizer touched paths (authoritative list for line-ref validation). */
  touchedPaths?: string[];
  /** Union of unauthorized paths (sanitizer ∪ client ∪ model) at grade time. */
  unauthorizedPaths?: string[];
}

export interface ScoreParts {
  criteria: number;
  scope: number;
  total: number;
}

export interface CategoryCounts {
  met: number;
  partial: number;
  unmet: number;
  total: number;
}

export type NextAuditDecision = 'merge' | 'revert_scope' | 'remediate' | 'blocked';

export interface AuditGrade {
  met: number;
  partial: number;
  unmet: number;
  total: number;
  criteriaScore: number;
  scopePenalty: number;
  overallScore: number;
  verdict: MergeVerdict['status'];
  scoreParts: ScoreParts;
  categoryRollup: Record<CriterionCategory, CategoryCounts>;
  diffFacts?: AuditDiffFacts;
  blast: { rating: BlastRadius['rating']; explanation: string; grounded: boolean };
  nextDecision: NextAuditDecision;
  why: string[];
}

export interface ScopeIntegrity {
  strictlyInScope: boolean;
  unauthorizedFiles: string[];
  explanation: string;
}

export interface BlastRadius {
  rating: 'LOW' | 'MEDIUM' | 'HIGH';
  explanation: string;
}

export interface MergeVerdict {
  status: 'READY_TO_MERGE' | 'NEEDS_REVISION' | 'BLOCKED';
  overallScore: number;
  keyBlockers: string[];
  actionableFeedbackForAgent: string;
  recommendation?: string;
}

export interface GeminiAuditReport {
  criteriaResults: CriterionResult[];
  scopeIntegrity: ScopeIntegrity;
  blastRadius: BlastRadius;
  mergeVerdict: MergeVerdict;
  evaluatedAt?: string;
  prTitle?: string;
  prAuthor?: string;
  prNumber?: number;
  prUrl?: string;
  baseBranch?: string;
  headBranch?: string;
  /** COR-40: PR head SHA that was graded. Null when unavailable — remediation blocked until re-evaluate. */
  auditedHeadSha?: string | null;
  /** Sanitizer file/line facts stamped at evaluate time. */
  diffFacts?: AuditDiffFacts;
  /** Server-computed single truth. UI renders this; recompute client-side only when missing (old cached reports). */
  grade?: AuditGrade;
}

export interface VaultBlueprintSummary {
  blueprintId: string;
  repo: string;
  branchName: string;
  baseBranch: string;
  objective: string;
  createdAt: string;
  updatedAt?: string;
  hasLastBrief: boolean;
}

export interface GitHubStatusSummary {
  mergeable: boolean | null;
  mergeableState: string;
  checksState: 'SUCCESS' | 'PENDING' | 'FAILURE';
  failedChecks: string[];
  /** Failed run names paired with their external details URLs. */
  checkRunUrls?: { name: string; detailsUrl: string }[];
}

export interface PRMetadata {
  title: string;
  number: number;
  author: string;
  authorAvatar?: string;
  htmlUrl: string;
  baseBranch: string;
  headBranch: string;
  /** COR-40: live PR head SHA from GitHub (prData.head.sha). Null for manual diffs. */
  headSha?: string | null;
  state: string;
  body?: string;
  embeddedBlueprint?: Blueprint | null;
  /** Physical GitHub merge readiness (checks + mergeable). Null when unavailable (e.g. manual diffs). */
  githubStatus?: GitHubStatusSummary | null;
}
