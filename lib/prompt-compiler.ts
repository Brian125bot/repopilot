import { Blueprint, AcceptanceCriterion } from '@/types';

export interface PromptCompilerInput {
  repo: string;
  baseBranch: string;
  branchName: string;
  fileBoundaries: string[];
  objective: string;
  criteria: AcceptanceCriterion[];
}

export function compileJulesPrompt(input: PromptCompilerInput, blueprintId: string): string {
  const criteriaList = input.criteria
    .map((c, index) => {
      const criterionText =
        c.text ||
        (c as unknown as { title?: string; description?: string }).title ||
        (c as unknown as { title?: string; description?: string }).description ||
        `Criterion ${index + 1}`;
      return `${index + 1}. [CRIT-${c.id || index + 1}] ${criterionText.trim()}`;
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

  return `# RepoPilot Autonomous Agent Contract
**Contract ID:** \`${blueprintId}\`
**Repository:** \`${input.repo}\`
**Base Branch:** \`${input.baseBranch}\`
**Target Branch:** \`${input.branchName}\`

---

## 1. Primary Objective
${input.objective}

---

## 2. Strict Scope & File Boundaries
The agent is authorized to modify ONLY files that match the following boundaries:
${fileBoundariesList}

### Anti-Drift Directives (Zero Tolerance)
1. **No Out-of-Scope Modifications:** DO NOT create, modify, rename, or delete any files outside the declared boundaries.
2. **Dependency Freeze:** DO NOT add, remove, or modify packages or version pins in \`package.json\`, \`package-lock.json\`, \`yarn.lock\`, \`pnpm-lock.yaml\`, or equivalent dependency manifests unless explicitly mandated in Section 1.
3. **No Tangential Refactoring:** Do not reformat unrelated code, touch unrelated test files, adjust linter configs, or rename existing public APIs unless directly required to satisfy the Acceptance Criteria.
4. **Minimal Diff Principle:** Keep diffs concise, readable, and surgical.

---

## 3. Mandatory Acceptance Criteria Matrix
You MUST implement code and tests satisfying every single criterion below:
${criteriaList}

---

## 4. Required Pull Request Embedding (MANDATORY)
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
