import { z } from 'zod';

/**
 * COR-56 goal ingestion types.
 *
 * `GoalExtracted` is Gemini's structured read of the operator's freeform text.
 * `Goal` is the persisted vault record. Both are validated with Zod because the
 * same schemas guard the API boundary (untrusted model output) and the vault
 * boundary (untrusted decrypted ciphertext).
 */

export const GOAL_RAW_TEXT_MAX = 20000;
export const GOAL_TITLE_MAX = 120;
export const GOAL_LIST_ITEM_MAX = 2000;
export const GOAL_LIST_MAX = 20;
export const GOAL_CONVENTIONS_MAX = 8;
export const GOAL_CONVENTION_BODY_MAX = 600;

/** Sentinel title the extractor must return when the input is not actionable. */
export const GOAL_UNCLEAR_TITLE = 'UNCLEAR';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

/**
 * One non-empty, length-capped string in a list field. Empty and blank-only
 * entries are rejected rather than silently dropped so the operator sees that
 * the model returned a malformed line instead of losing it.
 */
const goalListItem = (field: string) =>
  z
    .string({ message: `${field} entries must be strings.` })
    .trim()
    .min(1, `${field} entries must be non-empty strings.`)
    .max(GOAL_LIST_ITEM_MAX, `${field} entries must be ${GOAL_LIST_ITEM_MAX} characters or fewer.`);

function goalList(field: string) {
  return z
    .array(goalListItem(field), { message: `${field} must be an array of strings.` })
    .max(GOAL_LIST_MAX, `${field} must contain ${GOAL_LIST_MAX} entries or fewer.`);
}

/**
 * Model output schema. Deliberately NOT `.strict()`: Gemini's structured output
 * occasionally carries extra keys, and default key-stripping is safer than
 * failing the whole extraction over a field we ignore. The persisted record
 * (`GoalSchema`) is the opposite — it is our own data and must be strict.
 */
export const GoalExtractedSchema = z
  .object({
    title: z
      .string({ message: 'Goal title must be a string.' })
      .trim()
      .min(1, 'Goal title must be a non-empty string.')
      .max(GOAL_TITLE_MAX, `Goal title must be ${GOAL_TITLE_MAX} characters or fewer.`),
    scope: goalList('scope'),
    acceptanceCriteria: goalList('acceptanceCriteria'),
    assumptions: goalList('assumptions'),
    ambiguityFlags: goalList('ambiguityFlags'),
  })
  .refine((data) => data.title !== GOAL_UNCLEAR_TITLE || data.ambiguityFlags.length > 0, {
    message: 'A goal marked UNCLEAR must explain why in ambiguityFlags.',
    path: ['ambiguityFlags'],
  });

export type GoalExtracted = z.infer<typeof GoalExtractedSchema>;

/** True when the extractor (or the operator) has not resolved the goal. */
export function isGoalUnclear(extracted: GoalExtracted): boolean {
  return extracted.title === GOAL_UNCLEAR_TITLE || extracted.ambiguityFlags.length > 0;
}

/** Persisted vault record. Keyed by `sessionId` in the `goals-v1` object store. */
export const GoalSchema = z
  .object({
    id: z
      .string({ message: 'Goal id is required.' })
      .trim()
      .min(1, 'Goal id is required.')
      .refine((value) => UUID_PATTERN.test(value), { message: 'Goal id must be a UUID.' }),
    sessionId: z
      .string({ message: 'Goal session id is required.' })
      .trim()
      .min(1, 'Goal session id is required.')
      .max(200, 'Goal session id must be 200 characters or fewer.'),
    repo: z
      .string({ message: 'Goal repo is required.' })
      .trim()
      .min(1, 'Goal repo is required.')
      .max(200, 'Goal repo must be 200 characters or fewer.'),
    rawText: z
      .string({ message: 'Goal raw text is required.' })
      .trim()
      .min(1, 'Goal raw text is required.')
      .max(GOAL_RAW_TEXT_MAX, `Goal raw text must be ${GOAL_RAW_TEXT_MAX} characters or fewer.`),
    extracted: GoalExtractedSchema.nullable(),
    createdAt: isoTimestamp('createdAt'),
    updatedAt: isoTimestamp('updatedAt'),
  })
  .strict();

export type Goal = z.infer<typeof GoalSchema>;

export class GoalParseError extends Error {
  readonly issues: Array<{ field: string; message: string }>;
  constructor(message: string, issues: Array<{ field: string; message: string }> = []) {
    super(message);
    this.name = 'GoalParseError';
    this.issues = issues;
  }
}

function toParseIssues(error: z.ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

export function parseGoal(value: unknown): Goal {
  const result = GoalSchema.safeParse(value);
  if (!result.success) {
    const issues = toParseIssues(result.error);
    throw new GoalParseError(issues[0]?.message ?? 'Invalid Goal.', issues);
  }
  return result.data;
}

export function parseGoalExtracted(value: unknown): GoalExtracted {
  const result = GoalExtractedSchema.safeParse(value);
  if (!result.success) {
    const issues = toParseIssues(result.error);
    throw new GoalParseError(issues[0]?.message ?? 'Invalid GoalExtracted.', issues);
  }
  return result.data;
}

/**
 * Draft id used before a Jules session exists. The goal modal runs ahead of
 * dispatch, so there is no Jules session id to bind to yet; the record keeps
 * this id for the life of the goal rather than re-keying after dispatch (which
 * would mean holding the vault passphrase past the modal).
 */
export function buildDraftSessionId(): string {
  return `draft-${crypto.randomUUID()}`;
}

export interface BuildGoalInput {
  sessionId?: string;
  repo: string;
  rawText: string;
  extracted: GoalExtracted | null;
  now?: string;
}

/**
 * Pure factory that stamps the record identity and timestamps. Exported so the
 * storage and UI layers never hand-assemble a Goal and so the shape is covered
 * by tests without a DOM.
 */
export function buildGoal({ sessionId, repo, rawText, extracted, now }: BuildGoalInput): Goal {
  const timestamp = now ?? new Date().toISOString();
  const candidate: Goal = {
    id: crypto.randomUUID(),
    sessionId: sessionId?.trim() || buildDraftSessionId(),
    repo: repo.trim(),
    rawText: rawText.trim(),
    extracted,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return parseGoal(candidate);
}