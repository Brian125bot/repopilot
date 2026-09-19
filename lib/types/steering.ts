import { z } from 'zod';

export const STEERING_SCHEMA_VERSION = 1;

export class SteeringParseError extends Error {
  readonly issues: Array<{ field: string; message: string }>;
  constructor(message: string, issues: Array<{ field: string; message: string }> = []) {
    super(message);
    this.name = 'SteeringParseError';
    this.issues = issues;
  }
}

function isIso8601String(value: string): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (Number.isNaN(Date.parse(trimmed))) return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/.test(trimmed);
}

function isoTimestamp(field: string) {
  return z
    .string({ message: `${field} must be an ISO 8601 timestamp.` })
    .refine(isIso8601String, { message: `${field} must be an ISO 8601 timestamp.` });
}

function toParseIssues(error: z.ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

export const ConventionEntrySchema = z
  .object({
    id: z.string({ message: 'Convention id is required.' }).trim().min(1, 'Convention id is required.'),
    title: z.string({ message: 'Convention title is required.' }).trim().min(1, 'Convention title is required.'),
    body: z.string({ message: 'Convention body is required.' }).trim().min(1, 'Convention body is required.'),
    source: z.string().trim().min(1).optional(),
  })
  .strict();

export type ConventionEntry = z.infer<typeof ConventionEntrySchema>;

export const RepoProfileSchema = z
  .object({
    id: z.string({ message: 'Profile id is required.' }).trim().min(1, 'Profile id is required.'),
    repoRef: z
      .object({
        owner: z.string({ message: 'Repository owner is required.' }).trim().min(1, 'Repository owner is required.'),
        repo: z.string({ message: 'Repository name is required.' }).trim().min(1, 'Repository name is required.'),
        defaultBranch: z.string().trim().min(1).optional(),
      })
      .strict(),
    stack: z
      .object({
        packageManager: z.string().trim().min(1).optional(),
        testRunner: z.string().trim().min(1).optional(),
        framework: z.string().trim().min(1).optional(),
        languages: z.array(z.string().trim().min(1, 'Language entries must be non-empty strings.')),
      })
      .strict(),
    conventions: z.array(ConventionEntrySchema),
    customInstructions: z.string().max(8000, 'Custom instructions must be 8000 characters or fewer.').optional(),
    notes: z.string().max(8000, 'Notes must be 8000 characters or fewer.').optional(),
    updatedAt: isoTimestamp('updatedAt'),
    version: z
      .number({ message: 'Version must be a positive integer schema version.' })
      .int('Version must be a positive integer schema version.')
      .min(1, 'Version must be a positive integer schema version.'),
  })
  .strict();

export type RepoProfile = z.infer<typeof RepoProfileSchema>;

export const SnippetCategorySchema = z.enum(['investigation', 'verification', 'remediation', 'general']);

export type SnippetCategory = z.infer<typeof SnippetCategorySchema>;

export const SnippetSchema = z
  .object({
    id: z.string({ message: 'Snippet id is required.' }).trim().min(1, 'Snippet id is required.'),
    title: z
      .string({ message: 'Snippet title is required.' })
      .trim()
      .min(1, 'Snippet title is required.')
      .max(80, 'Snippet title must be 80 characters or fewer.'),
    content: z
      .string({ message: 'Snippet content is required.' })
      .trim()
      .min(1, 'Snippet content is required.')
      .max(8000, 'Snippet content must be 8000 characters or fewer.'),
    category: SnippetCategorySchema,
    isBuiltin: z.boolean(),
    isPinned: z.boolean().default(false),
    usageCount: z.number().int().min(0).default(0),
    createdAt: isoTimestamp('createdAt'),
    updatedAt: isoTimestamp('updatedAt'),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasBuiltinPrefix = data.id.startsWith('builtin-');
    if (data.isBuiltin && !hasBuiltinPrefix) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Built-in snippets must use the builtin- id prefix.',
      });
    }
    if (!data.isBuiltin && hasBuiltinPrefix) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isBuiltin'],
        message: 'Custom snippets must not use the builtin- id prefix.',
      });
    }
  });

export type Snippet = z.infer<typeof SnippetSchema>;

export function parseRepoProfile(value: unknown): RepoProfile {
  const result = RepoProfileSchema.safeParse(value);
  if (!result.success) {
    const issues = toParseIssues(result.error);
    throw new SteeringParseError(issues[0]?.message ?? 'Invalid RepoProfile.', issues);
  }
  return result.data;
}

export function parseSnippet(value: unknown): Snippet {
  const result = SnippetSchema.safeParse(value);
  if (!result.success) {
    const issues = toParseIssues(result.error);
    throw new SteeringParseError(issues[0]?.message ?? 'Invalid Snippet.', issues);
  }
  return result.data;
}
