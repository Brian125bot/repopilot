import { GoogleGenAI, Type } from '@google/genai';
import { AcceptanceCriterion, AuditDiffFacts, GeminiAuditReport, GeneratedCriteriaResponse, RepoInspectionResult } from '@/types';
import { attachAuditGrade, reconcileAuditReport } from '@/lib/scoring';

/** Char cap for the diff slice sent to Gemini. Keep in sync with lib/scoring.ts MAX_EVALUATE_DIFF_CHARS and sanitizer default (100k). */
export const MAX_EVALUATE_DIFF_CHARS = 80000;

export function getGeminiClient(customApiKey?: string): GoogleGenAI {
  const key = customApiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY is not configured on server or in client request headers.');
  }

  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'RepoPilot/1.0',
      },
    },
  });
}

const auditEvaluationSchema = {
  type: Type.OBJECT,
  properties: {
    criteriaResults: {
      type: Type.ARRAY,
      description: 'Audit result for each acceptance criterion evaluated against the diff.',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: 'Criterion ID (e.g. 1, 2, or CRIT-1)' },
          criterion: { type: Type.STRING, description: 'The text of the criterion' },
          status: {
            type: Type.STRING,
            enum: ['MET', 'PARTIALLY_MET', 'UNMET'],
            description: 'Verification status of this criterion based strictly on evidence in the diff.',
          },
          evidence: {
            type: Type.STRING,
            description: 'Direct code citations, logic explanation, or why it failed or succeeded.',
          },
          lineReferences: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'File and line numbers or hunk headers where implementation occurs (e.g. ["src/auth.ts:45-52"]).',
          },
          satisfiedAspects: {
            type: Type.STRING,
            description: 'For MET or PARTIALLY_MET: what already holds in the diff. Empty string if nothing holds.',
          },
          remainingWork: {
            type: Type.STRING,
            description: 'For PARTIALLY_MET or UNMET: the concrete gap still missing. Empty string if MET.',
          },
        },
        required: ['id', 'criterion', 'status', 'evidence', 'lineReferences'],
      },
    },
    scopeIntegrity: {
      type: Type.OBJECT,
      description: 'Verification of file boundaries and anti-drift constraints.',
      properties: {
        strictlyInScope: {
          type: Type.BOOLEAN,
          description: 'True if no unauthorized files were modified and anti-drift rules were respected.',
        },
        unauthorizedFiles: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'List of touched files that violate declared boundaries or anti-drift directives.',
        },
        explanation: {
          type: Type.STRING,
          description: 'Detailed analysis of scope compliance and any unrequested changes.',
        },
      },
      required: ['strictlyInScope', 'unauthorizedFiles', 'explanation'],
    },
    blastRadius: {
      type: Type.OBJECT,
      description: 'Assessment of codebase risk and change impact.',
      properties: {
        rating: {
          type: Type.STRING,
          enum: ['LOW', 'MEDIUM', 'HIGH'],
          description: 'Risk assessment of the diff size and complexity.',
        },
        explanation: {
          type: Type.STRING,
          description: 'Rationale analyzing total lines changed, files touched, and potential regression risks.',
        },
      },
      required: ['rating', 'explanation'],
    },
    mergeVerdict: {
      type: Type.OBJECT,
      description: 'The definitive merge readiness determination.',
      properties: {
        status: {
          type: Type.STRING,
          enum: ['READY_TO_MERGE', 'NEEDS_REVISION', 'BLOCKED'],
          description: 'Final recommendation.',
        },
        overallScore: {
          type: Type.INTEGER,
          description: 'Overall score from 0 (completely failed) to 100 (exemplary, perfect match).',
        },
        keyBlockers: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'List of critical deficiencies, missing requirements, or rule violations.',
        },
        actionableFeedbackForAgent: {
          type: Type.STRING,
          description: 'Exact prompt instructions to feed back into the AI agent or developer to remediate all issues.',
        },
      },
      required: ['status', 'overallScore', 'keyBlockers', 'actionableFeedbackForAgent'],
    },
  },
  required: ['criteriaResults', 'scopeIntegrity', 'blastRadius', 'mergeVerdict'],
};

export async function evaluateDiffAgainstCriteria({
  diff,
  criteria,
  objective,
  fileBoundaries,
  unauthorizedPaths,
  customApiKey,
  diffFacts,
  touchedPaths,
}: {
  diff: string;
  criteria: AcceptanceCriterion[];
  objective?: string;
  fileBoundaries?: string[];
  /** Deterministic out-of-scope paths from the diff sanitizer; forces scope verdict. Required — pass []. */
  unauthorizedPaths: string[];
  customApiKey?: string;
  diffFacts?: AuditDiffFacts;
  touchedPaths?: string[];
}): Promise<GeminiAuditReport> {
  const ai = getGeminiClient(customApiKey);

  const criteriaText = criteria
    .map((c, i) => `Criterion [${c.id || i + 1}]: "${c.text}" (Category: ${c.category || 'functional'})`)
    .join('\n');

  const boundariesText =
    fileBoundaries && fileBoundaries.length > 0
      ? fileBoundaries.map((b) => `- ${b}`).join('\n')
      : 'None specified (evaluate general anti-drift and architectural cleanliness).';

  const systemInstruction = `You are RepoPilot Evaluation & Audit Engine, an elite principal code reviewer and automated QA auditor.
Your job is to rigorously evaluate a git diff against an explicit Stage 1 Blueprint Contract:
1. Primary Objective
2. Strict Acceptance Criteria Matrix
3. Declared File Boundaries & Anti-Drift Directives (no unauthorized files, no lockfile tampering, no extraneous refactoring).

Evaluation Guidelines:
- Mark a criterion 'MET' ONLY if there is clear, concrete code implementation or tests in the diff fulfilling it. Fill 'satisfiedAspects' with what holds (1-2 sentences, max ~300 chars). Leave 'remainingWork' empty.
- Mark 'PARTIALLY_MET' if the intent is partially implemented but misses edge cases, error handling, or tests. Fill BOTH 'satisfiedAspects' (what already holds) and 'remainingWork' (the concrete gap, file + change needed). Each max ~300 chars, never empty.
- Mark 'UNMET' if the feature is completely missing or non-functional. Put what is absent in 'remainingWork' (concrete file + change needed, max ~300 chars). Leave 'satisfiedAspects' empty.
- In 'evidence', cite specific code patterns, function names, and logic paths found in the diff.
- In 'lineReferences', cite ONLY files present in the diff using 'path:lines' form (e.g. ["src/auth.ts:45-52"]). Never invent paths. Leave empty rather than guessing.
- In 'scopeIntegrity', strictly check if files in the diff violate the declared file boundaries.
- In 'blastRadius', describe regression risk in prose. Line-volume bands for the UI (not your merge score):
  * LOW: small, well-isolated changes (< 150 lines, focused files)
  * MEDIUM: moderate changes (150-500 lines or multiple core files, or non-critical out-of-scope docs/tests)
  * HIGH: massive changes (> 500 lines, wide architectural impact) or critical files touched (package.json, lockfiles, Dockerfile, .env, build configs, migrations, auth/security)
- Do not author the official merge score or verdict. RepoPilot recomputes those from criterion statuses plus the diff sanitizer (unauthorized files never READY; PARTIAL counts as half; −35 if any out-of-scope path). Still fill mergeVerdict fields: keyBlockers and actionableFeedbackForAgent must be concrete.
- In 'actionableFeedbackForAgent', write an uncompromising, ready-to-paste markdown remediation instruction tailored for the code generation agent.`;

  const shownDiff = diff.slice(0, MAX_EVALUATE_DIFF_CHARS);
  const truncatedNote =
    diff.length > MAX_EVALUATE_DIFF_CHARS
      ? `\n[NOTE: diff truncated to first ${MAX_EVALUATE_DIFF_CHARS.toLocaleString()} of ${diff.length.toLocaleString()} chars for token budget. Judge only what is shown.]`
      : '';

  const prompt = `Please audit the following Pull Request Diff against the Blueprint specifications:

=== STAGE 1 BLUEPRINT OBJECTIVE ===
${objective || 'Objective not specified.'}

=== AUTHORIZED FILE BOUNDARIES ===
${boundariesText}

=== ACCEPTANCE CRITERIA MATRIX ===
${criteriaText}

=== SANITIZED PULL REQUEST DIFF ===${truncatedNote}
${shownDiff}

Please output the complete structured audit report.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: auditEvaluationSchema,
      temperature: 0.1,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Gemini API returned an empty evaluation response.');
  }

  const parsed = JSON.parse(text) as Omit<GeminiAuditReport, 'evaluatedAt'>;
  const paths = Array.isArray(unauthorizedPaths) ? unauthorizedPaths : [];
  const reconciled = reconcileAuditReport(parsed, paths);

  // Server single truth: stamp categories, validate line refs, build grade,
  // and sync mergeVerdict from grade. UI renders report.grade when present.
  const graded = attachAuditGrade(reconciled, {
    criteria,
    diffFacts,
    touchedPaths,
    unauthorizedPaths: paths,
  });

  return {
    ...graded,
    evaluatedAt: new Date().toISOString(),
  };
}

const criteriaGenerationSchema = {
  type: Type.OBJECT,
  properties: {
    criteria: {
      type: Type.ARRAY,
      description: 'List of testable, concrete acceptance criteria establishing definition-of-done.',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: 'Sequential identifier, e.g. "1", "2"' },
          text: { type: Type.STRING, description: 'Clear, verifiable statement of what must be implemented or preserved' },
          category: {
            type: Type.STRING,
            enum: ['functional', 'security', 'testing', 'constraint'],
            description: 'The nature of this acceptance criterion',
          },
          rationale: {
            type: Type.STRING,
            description: 'Why this criterion is critical given the repo context and task objective',
          },
        },
        required: ['id', 'text', 'category', 'rationale'],
      },
    },
    recommendedFileBoundaries: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Recommended glob patterns or file paths strictly defining authorized blast radius',
    },
    suggestedBranchName: {
      type: Type.STRING,
      description: 'Semantic git branch name (e.g. jules/add-rate-limiter-redis)',
    },
    summaryRationale: {
      type: Type.STRING,
      description: 'Executive engineering summary explaining the architectural strategy and risk mitigation',
    },
    detectedArchitecture: {
      type: Type.STRING,
      description: 'Summary of the inferred or detected technology stack and design patterns',
    },
  },
  required: ['criteria', 'recommendedFileBoundaries', 'suggestedBranchName', 'summaryRationale', 'detectedArchitecture'],
};

export async function generateAcceptanceCriteria({
  repo,
  objective,
  repoContext,
  mode = 'standard',
  customApiKey,
}: {
  repo: string;
  objective: string;
  repoContext?: Partial<RepoInspectionResult>;
  mode?: 'standard' | 'security' | 'testing' | 'strict';
  customApiKey?: string;
}): Promise<GeneratedCriteriaResponse> {
  const ai = getGeminiClient(customApiKey);

  const keyFiles = repoContext?.keyFiles as
    | {
        dependenciesSummary?: string[];
        scriptsSummary?: Record<string, string>;
        testCommand?: string;
        framework?: string;
        packageManager?: string;
        hasTests?: boolean;
      }
    | undefined;
  const treePaths = (repoContext as { treePaths?: string[] } | undefined)?.treePaths;
  const treeTruncated = (repoContext as { treeTruncated?: boolean } | undefined)?.treeTruncated;
  const treeForPrompt =
    Array.isArray(treePaths) && treePaths.length > 0
      ? treePaths.slice(0, 100)
      : repoContext?.treePreview?.slice(0, 30) || [];
  const scriptsSummary = keyFiles?.scriptsSummary || {};
  const scriptsLine =
    Object.keys(scriptsSummary).length > 0
      ? Object.entries(scriptsSummary)
          .map(([k, v]) => `${k}: ${v}`)
          .join(' · ')
      : 'Not detected';

  const contextDetails = repoContext
    ? `
- Target Repository: ${repo}
- Description: ${repoContext.description || 'Not provided'}
- Primary Language: ${repoContext.primaryLanguage || 'Unknown'}
- Framework: ${keyFiles?.framework || 'unknown'}
- Default Branch: ${repoContext.defaultBranch || 'main'}
- Topics: ${repoContext.topics ? repoContext.topics.join(', ') : 'None'}
- Package Manager: ${keyFiles?.packageManager || 'npm'}
- Test Command: ${keyFiles?.testCommand || 'Not detected — tell Jules to use the repo\u2019s documented test command'}
- Has Tests Dir: ${keyFiles?.hasTests ? 'yes' : 'no / unknown'}
- Scripts: ${scriptsLine}
- Recursive Tree (${treeForPrompt.length} paths${treeTruncated ? ', truncated' : ''}):
  ${treeForPrompt.length > 0 ? treeForPrompt.map((f) => `  * ${f}`).join('\n') : '  * Directory tree not directly indexed'}
- Detected Dependencies & Environment:
  ${keyFiles?.dependenciesSummary?.length ? keyFiles.dependenciesSummary.join(', ') : 'Standard repository configuration'}
`
    : `Target Repository: ${repo} (Assume idiomatic conventions for this repo's likely domain).`;

  const strictBoundarySuffix =
    'Regardless of mode, enforce minimal blast radius: zero extraneous file modifications, no lockfile/config drift, backward compatibility, and file boundaries that match real repo paths.';
  const modeInstructions =
    (
      {
        standard: 'Provide a comprehensive, balanced matrix covering core functionality, unit testing, security constraints, and boundary limitations.',
        security: 'Emphasize defense-in-depth, input validation, authentication/authorization checks, rate limiting, credential safety, and safe error handling without data leaks.',
        testing: 'Emphasize comprehensive test coverage: unit tests for core algorithms, mock integration tests, failure modes, boundary condition tests, and regression guardrails.',
        strict: 'Emphasize minimal blast radius, zero extraneous file modifications, backward compatibility, zero breaking schema changes, and strict adherence to declared boundaries.',
      }[mode] || 'Provide a balanced engineering matrix.'
    ) + ` ${strictBoundarySuffix}`;

  const systemInstruction = `You are RepoPilot Criteria Architect, a Staff Principal Software Engineer and Code Review Authority.
Your mission is to analyze a developer's task objective AND the target repository's current state/architecture to automatically establish:
1. A rigorous, non-ambiguous Acceptance Criteria Matrix (4 to 7 criteria) that an autonomous code generation agent (such as Google Jules) can deterministically fulfill and that our automated audit engine can objectively verify.
2. Recommended File Boundaries (glob patterns or exact paths) that strictly constrain the agent's blast radius to authorized modules.
3. A semantic Git branch name following standard conventions (e.g., jules/feature-slug).
4. An executive rationale and detected architecture summary.

Guidelines:
- Every criterion must be falsifiable and verifiable from code inspection or test output. Avoid vague statements like "Code should be clean" or "Make it fast". Each criterion needs where (file/glob) + how-verified (test name, HTTP code, function signature).
- Write specific criteria: specify exact function/class names, parameters, HTTP status codes, error types, or test suites where relevant. Reference real paths from the recursive tree above — never invent files.
- Balance the matrix: include at least one functional, one testing, and one constraint criterion. Add security when the objective touches auth/input/crypto/rate-limiting.
- Categorize each criterion accurately:
  * 'functional': Core business logic or API behavior
  * 'security': Input sanitization, authorization, crypto, or leak prevention
  * 'testing': Explicit automated test requirements (unit, mock, or integration)
  * 'constraint': Boundaries, package management rules, or non-regression limits
- Recommend concise, practical file boundaries that match REAL repo paths from the tree (prefer existing files/dirs; e.g., for Next.js: app/api/**, lib/**; for Go: pkg/**, cmd/**). Never recommend a path with zero tree matches.
- Include the repo's test command in at least one testing criterion when known.
- Mode Focus: ${modeInstructions}`;

  const prompt = `Please establish the Acceptance Criteria Matrix and boundary parameters for the following task:

=== TARGET REPOSITORY CONTEXT ===
${contextDetails}

=== TASK OBJECTIVE & REQUIREMENTS ===
${objective}

=== GENERATION MODE ===
${mode.toUpperCase()} MODE: ${modeInstructions}

Generate the complete criteria matrix now.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: criteriaGenerationSchema,
      temperature: 0.2,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Gemini API returned an empty criteria response.');
  }

  const parsed = JSON.parse(text) as GeneratedCriteriaResponse;

  // Ensure ID format is clean
  parsed.criteria = parsed.criteria.map((c, idx) => ({
    ...c,
    id: c.id || String(idx + 1),
    category: c.category || 'functional',
  }));

  // P0 safety net: guarantee functional + testing + constraint so first-pass
  // never ships without tests or drift protection, even if the model skimps.
  // Caps at 7 total to avoid diluting focus.
  const hasCategory = (cat: string) =>
    parsed.criteria.some((c) => (c.category || 'functional') === cat);
  const testCommand =
    (repoContext?.keyFiles as { testCommand?: string } | undefined)?.testCommand?.trim() || '';
  if (!hasCategory('testing') && parsed.criteria.length < 7) {
    parsed.criteria.push({
      id: String(parsed.criteria.length + 1),
      text: testCommand
        ? `Unit tests cover the new behavior and run green via \`${testCommand}\``
        : 'Unit tests cover the new behavior including happy-path, failure modes, and boundary conditions',
      category: 'testing',
      rationale: 'First-pass PRs without tests fail audit; tests prove the behavior.',
    });
  }
  if (!hasCategory('constraint') && parsed.criteria.length < 7) {
    parsed.criteria.push({
      id: String(parsed.criteria.length + 1),
      text: 'Zero modifications outside declared file boundaries and no dependency manifest changes unless explicitly required',
      category: 'constraint',
      rationale: 'Prevents scope drift, the top first-pass failure mode.',
    });
  }

  return parsed;
}

