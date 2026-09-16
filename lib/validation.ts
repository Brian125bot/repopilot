import { NextRequest } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { z } from 'zod';

export interface ValidationErrorDetail {
  field: string;
  message: string;
}

export interface ValidationErrorResponse {
  success: false;
  code: 'INVALID_INPUT';
  error: string;
  message: string;
  details: ValidationErrorDetail[];
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; response: ReturnType<typeof apiError> };

/**
 * Format Zod errors into clean, safe error details without echoing raw payloads or secrets.
 */
export function formatZodError(error: z.ZodError): ValidationErrorResponse {
  const details: ValidationErrorDetail[] = error.issues.map((issue) => ({
    field: issue.path.join('.') || 'root',
    message: issue.message,
  }));

  const mainMessage = details.length > 0 ? details[0].message : 'Invalid request parameters';

  return {
    success: false,
    code: 'INVALID_INPUT',
    error: mainMessage,
    message: mainMessage,
    details,
  };
}

/**
 * Helper function to normalize repo strings (e.g. https://github.com/owner/repo.git -> owner/repo)
 */
function normalizeRepoString(val: string): string {
  return val
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

/**
 * Helper refinement for owner/repo format.
 */
function isValidOwnerRepo(val: string): boolean {
  const parts = val.split('/');
  return parts.length === 2 && parts[0].trim().length > 0 && parts[1].trim().length > 0;
}

/**
 * Parses and validates request body JSON against a Zod schema.
 */
export async function parseRequestBody<T>(
  schema: z.ZodType<T>,
  req?: NextRequest,
  route = '/api/unknown',
  requestId = createRequestId()
): Promise<ValidationResult<T>> {
  let rawJson: unknown;
  try {
    const text = req ? await req.text() : '';
    rawJson = text && text.trim() ? JSON.parse(text) : {};
  } catch {
    const errorBody: ValidationErrorResponse = {
      success: false,
      code: 'INVALID_INPUT',
      error: 'Invalid JSON body in request payload.',
      message: 'Invalid JSON body in request payload.',
      details: [{ field: 'body', message: 'Malformed JSON body.' }],
    };
    return {
      success: false,
      response: apiError(route, requestId, { status: 400, code: 'INVALID_INPUT', message: errorBody.message, details: { details: errorBody.details } }),
    };
  }

  const result = schema.safeParse(rawJson);
  if (!result.success) {
    return {
      success: false,
      response: apiError(route, requestId, { status: 400, code: 'INVALID_INPUT', message: formatZodError(result.error).message, details: { details: formatZodError(result.error).details } }),
    };
  }
  return { success: true, data: result.data };
}

/**
 * Parses and validates URL query parameters against a Zod schema.
 */
export function parseQueryParams<T>(
  schema: z.ZodType<T>,
  req?: NextRequest,
  route = '/api/unknown',
  requestId = createRequestId()
): ValidationResult<T> {
  const searchParams = req?.nextUrl?.searchParams ?? new URLSearchParams();
  const rawObj: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    if (key in rawObj) {
      const existing = rawObj[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        rawObj[key] = [existing, value];
      }
    } else {
      rawObj[key] = value;
    }
  }

  const result = schema.safeParse(rawObj);
  if (!result.success) {
    return {
      success: false,
      response: apiError(route, requestId, { status: 400, code: 'INVALID_INPUT', message: formatZodError(result.error).message, details: { details: formatZodError(result.error).details } }),
    };
  }
  return { success: true, data: result.data };
}

// ==========================================
// SCHEMAS FOR ALL 10 ROUTES
// ==========================================

export const AcceptanceCriterionSchema = z.object({
  id: z.string(),
  text: z.string(),
  category: z.string().optional(),
  rationale: z.string().optional(),
});

// 1. app/api/audit/evaluate
export const AuditEvaluateQuerySchema = z.object({});

export const AuditEvaluateBodySchema = z.object({
  diff: z
    .string({ message: 'Cannot evaluate empty diff. Please provide a valid sanitized diff.' })
    .trim()
    .min(1, 'Cannot evaluate empty diff. Please provide a valid sanitized diff.'),
  criteria: z
    .array(AcceptanceCriterionSchema)
    .min(1, 'Acceptance criteria matrix is required for audit evaluation.'),
  objective: z.string().optional(),
  fileBoundaries: z.array(z.string()).optional(),
  unauthorizedPaths: z.array(z.string()).optional(),
  prMetadata: z
    .object({
      title: z.string().optional(),
      author: z.string().optional(),
      number: z.number().optional(),
      htmlUrl: z.string().optional(),
      baseBranch: z.string().optional(),
      headBranch: z.string().optional(),
      headSha: z.string().optional().nullable(),
    })
    .optional(),
});

// 2. app/api/audit/fetch-diff
export const AuditFetchDiffBodySchema = z
  .object({
    prUrl: z.string().optional(),
    owner: z.string().optional(),
    repo: z.string().optional(),
    pullNumber: z.union([z.number(), z.string()]).optional(),
    headBranch: z.string().optional(),
    branchName: z.string().optional(),
    rawDiff: z.string().optional(),
    fileBoundaries: z.array(z.string()).optional(),
  })
  .refine(
    (data) => {
      const hasRaw = Boolean(data.rawDiff && data.rawDiff.trim().length > 0);
      const hasTarget = Boolean(data.prUrl || data.owner || data.repo || data.headBranch || data.branchName);
      return hasRaw || hasTarget;
    },
    {
      message: 'Missing GitHub repository owner, repo, or pull request number. Provide a PR URL or a repo plus head branch.',
    }
  );

// 3. app/api/criteria/generate
export const CriteriaGenerateBodySchema = z.object({
  repo: z
    .string({ message: 'Valid repository in "owner/repo" format is required.' })
    .transform(normalizeRepoString)
    .refine(isValidOwnerRepo, {
      message: 'Valid repository in "owner/repo" format is required.',
    }),
  objective: z
    .string({ message: 'Please provide a descriptive task objective (at least 10 characters) to establish criteria.' })
    .trim()
    .min(10, 'Please provide a descriptive task objective (at least 10 characters) to establish criteria.'),
  repoContext: z.record(z.string(), z.unknown()).nullable().optional(),
  mode: z.enum(['standard', 'security', 'testing', 'strict']).default('standard'),
});

// 4. app/api/github/status
export const GithubStatusQuerySchema = z.object({});
export const GithubStatusBodySchema = z
  .object({
    pat: z.string().optional(),
  })
  .optional();

// 5. app/api/jules/dispatch (SECURITY SENSITIVE -> .strict())
export const JulesDispatchBodySchema = z
  .object({
    repo: z
      .string({ message: 'Invalid repository. Please specify in "owner/repo" format.' })
      .transform(normalizeRepoString)
      .refine(isValidOwnerRepo, {
        message: 'Invalid repository. Please specify in "owner/repo" format.',
      }),
    objective: z.string().optional(),
    baseBranch: z.string().optional(),
    branchName: z.string().optional(),
    startingBranch: z.string().optional(),
    explicitStartingBranch: z.string().optional(),
    fileBoundaries: z.union([z.array(z.string()), z.string()]).optional(),
    criteria: z.array(AcceptanceCriterionSchema).optional(),
    isRemediation: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    customPrompt: z.string().optional(),
    repoContext: z.record(z.string(), z.unknown()).nullable().optional(),
    testCommand: z.string().optional(),
    prNumber: z.union([z.number(), z.string()]).optional(),
    prUrl: z.string().optional(),
    auditedHeadSha: z.string().optional().nullable(),
    currentHeadSha: z.string().optional().nullable(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const isRemediation = Boolean(data.isRemediation);
    const rawObjective = data.objective?.trim() || '';
    if (!isRemediation && !rawObjective) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['objective'],
        message: 'Objective and task description is required.',
      });
    }

    const requestedHead = data.startingBranch?.trim() || data.branchName?.trim() || data.explicitStartingBranch?.trim() || '';
    // COR-11 kept: never allow missing or main/default fallback for remediation.
    if (isRemediation && (!requestedHead || requestedHead.toLowerCase() === 'main')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['branchName'],
        message: 'Remediation requires startingBranch = audited PR head',
      });
    }

    // COR-40: remediation is locked to the audited commit, not the drifted tip.
    // Omission of currentHeadSha is a reject, not an allow.
    if (isRemediation) {
      const audited = (data.auditedHeadSha || '').trim();
      if (!audited) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['auditedHeadSha'],
          message: 'Remediation blocked — re-evaluate to lock audited head SHA.',
        });
      } else {
        const current = (data.currentHeadSha || '').trim();
        if (!current || current.toLowerCase() !== audited.toLowerCase()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['currentHeadSha'],
            message: 'Head moved since audit — re-evaluate.',
          });
        }
      }
    }

    const rawCriteria = data.criteria;
    const hasCriteria = rawCriteria && rawCriteria.length > 0;
    if (!isRemediation && !hasCriteria) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['criteria'],
        message: 'At least one Acceptance Criterion is required.',
      });
    }
  });

// 6. app/api/jules/message (SECURITY SENSITIVE -> .strict())
export const JulesMessageBodySchema = z
  .object({
    sessionId: z
      .string({ message: 'Session ID is required. Provide sessionId.' })
      .trim()
      .min(1, 'Session ID is required. Provide sessionId.'),
    prompt: z
      .string({ message: 'Prompt is required. Provide prompt.' })
      .trim()
      .min(1, 'Prompt is required. Provide prompt.'),
    isRemediation: z.boolean().optional(),
    prUrl: z.string().optional(),
    auditedHeadSha: z.string().optional().nullable(),
    currentHeadSha: z.string().optional().nullable(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // COR-40: continuation lock. Non-remediation follow-ups stay open.
    // Empty / whitespace / null all reject with the same human error.
    if (!data.isRemediation) return;
    const audited = (data.auditedHeadSha || '').trim();
    const current = (data.currentHeadSha || '').trim();
    if (!audited || !current || current.toLowerCase() !== audited.toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currentHeadSha'],
        message: 'Head moved since audit — re-evaluate.',
      });
    }
  });

// 7. app/api/jules/session
export const JulesSessionQuerySchema = z.object({
  id: z
    .string({ message: 'Session ID is required. Provide ?id=sessions/xxx.' })
    .trim()
    .min(1, 'Session ID is required. Provide ?id=sessions/xxx.'),
  blueprintId: z.string().optional(),
  repo: z.string().optional(),
});

// 8. app/api/jules/sources
export const JulesSourcesQuerySchema = z.object({});

// 9. app/api/repo/inspect
export const RepoInspectBodySchema = z.object({
  repo: z
    .string({ message: 'Repository must be in "owner/repo" format (e.g., vercel/next.js).' })
    .transform(normalizeRepoString)
    .refine(isValidOwnerRepo, {
      message: 'Repository must be in "owner/repo" format (e.g., vercel/next.js).',
    }),
});

// 10. app/api/vault (SECURITY SENSITIVE -> .strict())
export const VaultGetQuerySchema = z.object({
  id: z.string().optional(),
});

export const VaultDeleteQuerySchema = z.object({
  id: z
    .string({ message: 'A blueprint id query parameter is required.' })
    .trim()
    .min(1, 'A blueprint id query parameter is required.'),
});

export const VaultPostBodySchema = z
  .object({
    blueprint: z
      .object({
        blueprintId: z
          .string({ message: 'A blueprint with a non-empty blueprintId is required.' })
          .trim()
          .min(1, 'A blueprint with a non-empty blueprintId is required.'),
        repo: z.string().optional(),
        baseBranch: z.string().optional(),
        branchName: z.string().optional(),
        fileBoundaries: z.array(z.string()).optional(),
        objective: z.string().optional(),
        criteria: z.array(z.unknown()).optional(),
        createdAt: z.string().optional(),
        sessionId: z.string().optional(),
        compiledPrompt: z.string().optional(),
        sourceName: z.string().optional(),
        sessionUrl: z.string().optional(),
        sessionState: z.string().optional(),
        prUrl: z.string().optional(),
        prTitle: z.string().optional(),
        isRemediation: z.boolean().optional(),
      })
      .passthrough()
      .refine((bp) => Boolean(bp.blueprintId && bp.blueprintId.trim()), {
        message: 'A blueprint with a non-empty blueprintId is required.',
      }),
  })
  .strict();

// Inferred TypeScript types
export type AuditEvaluateBody = z.infer<typeof AuditEvaluateBodySchema>;
export type AuditFetchDiffBody = z.infer<typeof AuditFetchDiffBodySchema>;
export type CriteriaGenerateBody = z.infer<typeof CriteriaGenerateBodySchema>;
export type GithubStatusBody = z.infer<typeof GithubStatusBodySchema>;
export type JulesDispatchBody = z.infer<typeof JulesDispatchBodySchema>;
export type JulesMessageBody = z.infer<typeof JulesMessageBodySchema>;
export type JulesSessionQuery = z.infer<typeof JulesSessionQuerySchema>;
export type RepoInspectBody = z.infer<typeof RepoInspectBodySchema>;
export type VaultGetQuery = z.infer<typeof VaultGetQuerySchema>;
export type VaultDeleteQuery = z.infer<typeof VaultDeleteQuerySchema>;
export type VaultPostBody = z.infer<typeof VaultPostBodySchema>;
