export interface AcceptanceCriterion {
  id: string;
  text: string;
  category?: 'functional' | 'security' | 'testing' | 'constraint';
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
  keyFiles?: {
    hasPackageJson?: boolean;
    hasTsConfig?: boolean;
    hasDocker?: boolean;
    hasTests?: boolean;
    dependenciesSummary?: string[];
    readmeExcerpt?: string;
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
}

export interface PRMetadata {
  title: string;
  number: number;
  author: string;
  authorAvatar?: string;
  htmlUrl: string;
  baseBranch: string;
  headBranch: string;
  state: string;
  body?: string;
  embeddedBlueprint?: Blueprint | null;
}
