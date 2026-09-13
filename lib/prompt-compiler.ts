import { Blueprint, AcceptanceCriterion, GeminiAuditReport, RepoInspectionResult } from '@/types';
import {
  buildAuditGrade,
  nextDecisionSentence,
  sortCriteriaForDecision,
} from '@/lib/scoring';
import { deriveDoNotTouchList, pickFilesToReadFirst } from '@/lib/contract-lint';
import { matchesFileBoundary } from '@/lib/diff-sanitizer';

export interface BoundaryValidation {
  validGlobs: string[];
  rejectedGlobs: string[];
}

/**
 * Verifies proposed boundary globs against real repository paths using true
 * glob matching (not prefix heuristics). A glob is valid only if at least
 * one actual path matches it. Empty globs are dropped silently; with no tree
 * available every glob passes through unchanged (cannot validate).
 */
export function validateAndFilterBoundaries(
  proposedGlobs: string[],
  actualPaths: string[]
): BoundaryValidation {
  const validGlobs: string[] = [];
  const rejectedGlobs: string[] = [];
  const tree = (Array.isArray(actualPaths) ? actualPaths : []).filter(Boolean);
  for (const raw of proposedGlobs || []) {
    const glob = (raw || '').trim();
    if (!glob) continue;
    if (tree.length === 0) {
      validGlobs.push(glob);
      continue;
    }
    if (tree.some((p) => matchesFileBoundary(p, [glob]))) {
      if (!validGlobs.includes(glob)) validGlobs.push(glob);
    } else if (!rejectedGlobs.includes(glob)) {
      rejectedGlobs.push(glob);
    }
  }
  return { validGlobs, rejectedGlobs };
}

/**
 * Falls back to real top-level directories (most files first) when every
 * proposed boundary was hallucinated. Returns e.g. ['lib/**', 'components/**'].
 * Empty tree yields [] so callers keep the original list.
 */
export function fallbackBoundariesFromTree(actualPaths: string[], maxDirs = 4): string[] {
  const tree = (Array.isArray(actualPaths) ? actualPaths : []).filter(Boolean);
  if (tree.length === 0) return [];
  const counts = new Map<string, number>();
  for (const p of tree) {
    const top = p.split('/')[0]?.trim();
    if (!top || !p.includes('/')) continue;
    counts.set(top, (counts.get(top) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, maxDirs))
    .map(([dir]) => `${dir}/**`);
}

export interface PromptCompilerInput {
  repo: string;
  baseBranch: string;
  branchName: string;
  fileBoundaries: string[];
  objective: string;
  criteria: AcceptanceCriterion[];
  /** Deep repo grounding (P1). When omitted the prompt falls back to the legacy lean contract. */
  repoContext?: Partial<RepoInspectionResult> | null;
  /** Explicit test command (defaults to repoContext.keyFiles.testCommand). */
  testCommand?: string;
}

function formatCategoryLabel(category?: string): string {
  const c = (category || 'functional').toLowerCase();
  if (c === 'security' || c === 'testing' || c === 'constraint' || c === 'functional') return c;
  return 'functional';
}

export function compileJulesPrompt(input: PromptCompilerInput, blueprintId: string): string {
  const criteriaList = input.criteria
    .map((c, index) => {
      const criterionText =
        c.text ||
        (c as unknown as { title?: string; description?: string }).title ||
        (c as unknown as { title?: string; description?: string }).description ||
        `Criterion ${index + 1}`;
      const category = formatCategoryLabel(c.category);
      const why = (c.rationale || '').trim() ? `\n   Why: ${(c.rationale || '').trim()}` : '';
      return `${index + 1}. [CRIT-${c.id || index + 1}][${category}] ${criterionText.trim()}${why}`;
    })
    .join('\n');

  const fileBoundariesList = input.fileBoundaries.length > 0
    ? input.fileBoundaries.map((b) => `- \`${b.trim()}\``).join('\n')
    : '- Any file relevant to the immediate objective, strictly adhering to anti-drift rules.';

  const blueprintPayload: Blueprint = {
    blueprintId,
    repo: input.repo,
    baseBranch: input.baseBranch,
    branchName: input.branchName,
    fileBoundaries: input.fileBoundaries,
    objective: input.objective,
    criteria: input.criteria,
    createdAt: new Date().toISOString(),
  };

  const blueprintJson = JSON.stringify(blueprintPayload);

  // P0/P1 grounding: repo stack, files-to-read, test command, explicit DO-NOT list.
  // All derived — never invented. Empty when no repoContext was supplied.
  const repoContext = input.repoContext || null;
  const treePaths = Array.isArray(repoContext?.treePreview) ? repoContext.treePreview || [] : [];
  const recursivePaths = Array.isArray((repoContext as { treePaths?: string[] } | null)?.treePaths)
    ? ((repoContext as unknown as { treePaths?: string[] }).treePaths || [])
    : [];
  const groundingTree = recursivePaths.length > 0 ? recursivePaths : treePaths;
  const filesToRead = pickFilesToReadFirst(input.fileBoundaries, groundingTree, 6);
  const doNotTouch = deriveDoNotTouchList(repoContext);
  const keyFiles = repoContext?.keyFiles as
    | { testCommand?: string; framework?: string; packageManager?: string; dependenciesSummary?: string[] }
    | undefined;
  const testCommand =
    (input.testCommand || '').trim() ||
    (keyFiles?.testCommand || '').trim() ||
    '';
  const framework = (keyFiles?.framework || '').trim() || (repoContext?.primaryLanguage || '').trim() || 'Not detected';
  const stackLine = [
    framework ? `Stack: ${framework}` : null,
    repoContext?.primaryLanguage ? `Language: ${repoContext.primaryLanguage}` : null,
    keyFiles?.packageManager ? `Pkg: ${keyFiles.packageManager}` : null,
    keyFiles?.dependenciesSummary?.length ? `Deps: ${keyFiles.dependenciesSummary.slice(0, 6).join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const groundingSection = repoContext
    ? `\n## 0. Repo Grounding (do not guess — verify against these)\n${stackLine ? `${stackLine}\n` : ''}${
        filesToRead.length > 0
          ? `Read first (exact paths):\n${filesToRead.map((f) => `- \`${f}\``).join('\n')}\n`
          : 'Read first: list files matching §2 boundaries with `git status` / tree before editing.\n'
      }${testCommand ? `Test before PR: \`${testCommand}\`\n` : 'Test before PR: run the repo\'s documented test command for touched files.\n'}`
    : '';

  const doNotSection =
    doNotTouch.length > 0
      ? `\nExplicit DO NOT touch in this repo (present on disk): ${doNotTouch.map((d) => `\`${d}\``).join(', ')}. Touching any of these fails audit (−35, never READY).`
      : '';

  return `# RepoPilot Autonomous Agent Contract
**Contract ID:** \`${blueprintId}\`
**Repository:** \`${input.repo}\`
**Base Branch:** \`${input.baseBranch}\`
**Target Branch:** \`${input.branchName}\`
${groundingSection}
---

## 1. Primary Objective
${input.objective}

---

## 2. Strict Scope & File Boundaries
The agent is authorized to modify ONLY files that match the following boundaries:
${fileBoundariesList}${doNotSection}

### Anti-Drift Directives (Zero Tolerance)
1. **No Out-of-Scope Modifications:** DO NOT create, modify, rename, or delete any files outside the declared boundaries.
2. **Dependency Freeze:** DO NOT add, remove, or modify packages or version pins in \`package.json\`, \`package-lock.json\`, \`yarn.lock\`, \`pnpm-lock.yaml\`, or equivalent dependency manifests unless explicitly mandated in Section 1.
3. **No Tangential Refactoring:** Do not reformat unrelated code, touch unrelated test files, adjust linter configs, or rename existing public APIs unless directly required to satisfy the Acceptance Criteria.
4. **Minimal Diff Principle:** Keep diffs concise, readable, and surgical.

---

## 3. Mandatory Acceptance Criteria Matrix
You MUST implement code and tests satisfying every single criterion below. Each line shows \`[category]\` and, when supplied, \`Why:\` — preserve the intent, do not deprioritize testing/constraint rows:
${criteriaList}

---

## 4. Definition of Done + Self-Check Before PR (do all of these)
- [ ] Every criterion in §3 has code + tests visible in the diff (PARTIAL counts half — finish it).
- [ ] ${testCommand ? `Ran \`${testCommand}\` for touched files — green.` : 'Ran the repo\'s test command for touched files — green.'}
- [ ] \`git status\` shows ONLY §2 files (no lockfiles, configs, or unrelated tests).
- [ ] PR title summarizes §1; PR body ends with the exact <!-- AUDIT_BLUEPRINT --> block below (if stripped, re-append once and re-push).

---

## 5. Required Pull Request Embedding (MANDATORY)
When opening the Pull Request, you MUST include the following hidden HTML comment block at the very bottom of the Pull Request description body. This comment is ingested by the RepoPilot Stage 2 Evaluation & Audit Engine for verification:

<!-- AUDIT_BLUEPRINT: ${blueprintJson} -->

**Verification requirement:** Do NOT alter the structure or keys of the \`AUDIT_BLUEPRINT\` JSON payload. Ensure the pull request title succinctly summarizes this objective.`;
}

export function extractBlueprintFromPRBody(body: string): Blueprint | null {
  if (!body) return null;
  const regex = /<!--\s*AUDIT_BLUEPRINT:\s*({[\s\S]*?})\s*-->/;
  const match = body.match(regex);
  if (!match || !match[1]) return null;

  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && parsed.blueprintId && Array.isArray(parsed.criteria)) {
      return parsed as Blueprint;
    }
  } catch (err) {
    console.error('Failed to parse embedded AUDIT_BLUEPRINT JSON:', err);
  }
  return null;
}

export interface RemediationPromptInput {
  targetBranch: string;
  baseBranch?: string;
  prNumber?: number;
  prUrl?: string;
  report: GeminiAuditReport;
  fileBoundaries?: string[];
}

export function compileRemediationPrompt(input: RemediationPromptInput): string {
  const { targetBranch, baseBranch = 'main', prNumber, prUrl, report, fileBoundaries } = input;
  const { criteriaResults, scopeIntegrity, mergeVerdict } = report;

  // Grade truth when the server attached it; otherwise derive the same math
  // locally so the prompt never contradicts the scorecard.
  const grade =
    report.grade ??
    buildAuditGrade(report, {
      diffFacts: report.diffFacts,
    });
  const verdict = grade.verdict;
  const score = grade.overallScore;
  const nextStep = nextDecisionSentence(grade.nextDecision, targetBranch);

  const prReference = prNumber
    ? `active Pull Request #${prNumber}`
    : prUrl
    ? `active Pull Request: ${prUrl}`
    : `active Pull Request`;

  const unauthorizedSection =
    scopeIntegrity?.unauthorizedFiles && scopeIntegrity.unauthorizedFiles.length > 0
      ? `\n- **Unauthorized Files to Revert:** ${scopeIntegrity.unauthorizedFiles.join(', ')}`
      : '';

  const blockersSection =
    mergeVerdict.keyBlockers && mergeVerdict.keyBlockers.length > 0
      ? mergeVerdict.keyBlockers.map((b, i) => `${i + 1}. ${b}`).join('\n')
      : '1. None identified.';

  // Decision-first: UNMET, then PARTIAL. Each open row carries Remaining (the
  // concrete gap) and, for PARTIAL, Satisfied (what to preserve).
  const openRanked = sortCriteriaForDecision(
    (criteriaResults || []).filter((c) => c.status !== 'MET')
  );
  const unmetCriteriaSection =
    criteriaResults && criteriaResults.length > 0
      ? openRanked
          .map((c) => {
            const remaining = (c.remainingWork || '').trim()
              ? `\n  Remaining: ${c.remainingWork!.trim()}`
              : '';
            const satisfied =
              c.status === 'PARTIALLY_MET' && (c.satisfiedAspects || '').trim()
                ? `\n  Satisfied (preserve): ${c.satisfiedAspects!.trim()}`
                : '';
            const category = c.category ? `\n  Category: ${c.category}` : '';
            return `- [${c.status}] Criterion ${c.id}: ${c.criterion}\n  Evidence: ${c.evidence}${satisfied}${remaining}${category}`;
          })
          .join('\n') || '- All declared criteria were satisfied.'
      : '- No explicit criteria recorded.';

  const boundariesSection =
    fileBoundaries && fileBoundaries.length > 0
      ? `\n\n#### Authorized File Boundaries:\n${fileBoundaries.map((f) => `- \`${f}\``).join('\n')}`
      : '';

  const changeRiskLine = grade.diffFacts
    ? `\n- **Change Risk:** ${grade.blast.rating} — ${grade.diffFacts.filesTouched} files, +${grade.diffFacts.linesAdded}/−${grade.diffFacts.linesRemoved}${grade.diffFacts.truncated ? ' (diff truncated; risk may be understated)' : ''}${grade.blast.grounded ? '' : ' (model estimate — line stats unavailable)'}`
    : '';

  return `### CRITICAL BRANCH WORKFLOW DIRECTIVE:
You are assigned to remediate ${prReference}:
${prUrl || ''}

You MUST check out and apply all code modifications directly to the audited branch:
\`${targetBranch}\`

DO NOT create an alternate branch or start over from the base branch (${baseBranch}). All fixes, refactors, and test additions must be committed and pushed directly to \`${targetBranch}\` so the pull request automatically updates with your changes.

---

### Audit Findings & Blockers:
- **Verdict:** ${verdict} (${score}/100)
- **Score:** ${grade.scoreParts.criteria} criteria − ${grade.scoreParts.scope} scope = ${score}
- **Next:** ${nextStep}
- **Scope Integrity:** ${scopeIntegrity.strictlyInScope ? 'Compliant' : 'VIOLATED'}${unauthorizedSection}${changeRiskLine}

#### Key Blockers:
${blockersSection}

#### Unmet / Partially Met Acceptance Criteria (decision order):
${unmetCriteriaSection}

#### Required Actionable Changes:
${mergeVerdict.actionableFeedbackForAgent}${boundariesSection}`;
}

