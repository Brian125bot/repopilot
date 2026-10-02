import { z } from 'zod';

export const GoalExtractedSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  scope: z.string().trim().default(''),
  acceptanceCriteria: z.array(z.string().trim()).default([]),
  assumptions: z.array(z.string().trim()).default([]),
  ambiguityFlags: z.array(z.string().trim()).default([]),
});

export type GoalExtracted = z.infer<typeof GoalExtractedSchema>;

export const GoalSchema = z.object({
  id: z.string().min(1, 'Goal ID is required'),
  sessionId: z.string().min(1, 'Session ID is required'),
  repo: z.string().default(''),
  rawText: z.string().default(''),
  extracted: GoalExtractedSchema.nullable().default(null),
  createdAt: z.string().min(1, 'createdAt timestamp is required'),
  updatedAt: z.string().min(1, 'updatedAt timestamp is required'),
});

export type Goal = z.infer<typeof GoalSchema>;
