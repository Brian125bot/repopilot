import { GoogleGenAI, Type } from '@google/genai';
import { AcceptanceCriterion, GeminiAuditReport, GeneratedCriteriaResponse, RepoInspectionResult } from '@/types';

export function getGeminiClient(customApiKey?: string): GoogleGenAI {
  const key = customApiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY is not configured on server or in client request headers.');
  }

  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
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
  customApiKey,
}: {
  diff: string;
  criteria: AcceptanceCriterion[];
  objective?: string;
  fileBoundaries?: string[];
  customApiKey?: string;
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
- Mark a criterion 'MET' ONLY if there is clear, concrete code implementation or tests in the diff fulfilling it.
- Mark 'PARTIALLY_MET' if the intent is partially implemented but misses edge cases, error handling, or tests.
- Mark 'UNMET' if the feature is completely missing or non-functional.
- In 'evidence', cite specific code patterns, function names, and logic paths found in the diff.
- In 'lineReferences', cite affected filenames and approximate line ranges or hunk indicators.
- In 'scopeIntegrity', strictly check if files in the diff violate the declared file boundaries.
- In 'blastRadius', evaluate the regression risk:
  * LOW: small, well-isolated changes (< 150 lines, focused files)
  * MEDIUM: moderate changes (150-500 lines or multiple core files)
  * HIGH: massive changes (> 500 lines, wide architectural impact, or critical files touched)
- In 'mergeVerdict', compute a fair 0-100 score:
  * 90-100 & all criteria MET & strictly in scope -> 'READY_TO_MERGE'
  * 60-89 or minor criteria unmet -> 'NEEDS_REVISION'
  * < 60 or major criteria unmet or unauthorized files/lockfile violations -> 'BLOCKED'
- In 'actionableFeedbackForAgent', write an uncompromising, ready-to-paste markdown remediation instruction tailored for the code generation agent.`;

  const prompt = `Please audit the following Pull Request Diff against the Blueprint specifications:

=== STAGE 1 BLUEPRINT OBJECTIVE ===
${objective || 'Objective not specified.'}

=== AUTHORIZED FILE BOUNDARIES ===
${boundariesText}

=== ACCEPTANCE CRITERIA MATRIX ===
${criteriaText}

=== SANITIZED PULL REQUEST DIFF ===
${diff.slice(0, 80000)}

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

  return {
    ...parsed,
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

  const contextDetails = repoContext
    ? `
- Target Repository: ${repo}
- Description: ${repoContext.description || 'Not provided'}
- Primary Language: ${repoContext.primaryLanguage || 'Unknown'}
- Default Branch: ${repoContext.defaultBranch || 'main'}
- Topics: ${repoContext.topics ? repoContext.topics.join(', ') : 'None'}
- Key Structure / Files Preview:
  ${repoContext.treePreview ? repoContext.treePreview.slice(0, 30).map((f) => `  * ${f}`).join('\n') : '  * Directory tree not directly indexed'}
- Detected Dependencies & Environment:
  ${repoContext.keyFiles?.dependenciesSummary?.length ? repoContext.keyFiles.dependenciesSummary.join(', ') : 'Standard repository configuration'}
`
    : `Target Repository: ${repo} (Assume idiomatic conventions for this repo's likely domain).`;

  const modeInstructions = {
    standard: 'Provide a comprehensive, balanced matrix covering core functionality, unit testing, security constraints, and boundary limitations.',
    security: 'Emphasize defense-in-depth, input validation, authentication/authorization checks, rate limiting, credential safety, and safe error handling without data leaks.',
    testing: 'Emphasize comprehensive test coverage: unit tests for core algorithms, mock integration tests, failure modes, boundary condition tests, and regression guardrails.',
    strict: 'Emphasize minimal blast radius, zero extraneous file modifications, backward compatibility, zero breaking schema changes, and strict adherence to declared boundaries.',
  }[mode] || 'Provide a balanced engineering matrix.';

  const systemInstruction = `You are RepoPilot Criteria Architect, a Staff Principal Software Engineer and Code Review Authority.
Your mission is to analyze a developer's task objective AND the target repository's current state/architecture to automatically establish:
1. A rigorous, non-ambiguous Acceptance Criteria Matrix (4 to 7 criteria) that an autonomous code generation agent (such as Google Jules) can deterministically fulfill and that our automated audit engine can objectively verify.
2. Recommended File Boundaries (glob patterns or exact paths) that strictly constrain the agent's blast radius to authorized modules.
3. A semantic Git branch name following standard conventions (e.g., jules/feature-slug).
4. An executive rationale and detected architecture summary.

Guidelines:
- Every criterion must be falsifiable and verifiable from code inspection or test output. Avoid vague statements like "Code should be clean" or "Make it fast".
- Write specific criteria: specify exact function/class names, parameters, HTTP status codes, error types, or test suites where relevant.
- Categorize each criterion accurately:
  * 'functional': Core business logic or API behavior
  * 'security': Input sanitization, authorization, crypto, or leak prevention
  * 'testing': Explicit automated test requirements (unit, mock, or integration)
  * 'constraint': Boundaries, package management rules, or non-regression limits
- Recommend concise, practical file boundaries matching the repo's language and project structure (e.g., for Next.js: app/api/**, lib/**; for Go: pkg/**, cmd/**).
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

  return parsed;
}

