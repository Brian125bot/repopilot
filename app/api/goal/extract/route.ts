import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { extractGoalFromText } from '@/lib/gemini';
import { GoalExtractedSchema } from '@/lib/goals/types';
import { GoalExtractBodySchema, parseRequestBody } from '@/lib/validation';

const ROUTE = '/api/goal/extract';

/**
 * COR-56 goal extraction proxy.
 *
 * Zero-auth contract: the Gemini key arrives in the `x-gemini-api-key` header
 * from client-side vault storage and is never read from, or written to, the
 * server environment. Nothing about the request is logged beyond the fixed
 * requestId/status/code triple that `apiError` emits.
 */
export async function POST(req: NextRequest) {
  const requestId = createRequestId();

  try {
    const bodyValidation = await parseRequestBody(GoalExtractBodySchema, req, ROUTE, requestId);
    if (!bodyValidation.success) return bodyValidation.response;

    const { rawText, repoProfile } = bodyValidation.data;

    const headerKey = req.headers.get('x-gemini-api-key')?.trim() || '';
    const customApiKey = headerKey || undefined;
    if (!customApiKey) {
      return apiError(ROUTE, requestId, {
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'No Gemini API key available. Unlock the credential vault and retry.',
      });
    }

    let extracted: unknown;
    try {
      extracted = await extractGoalFromText({ rawText, repoProfile, customApiKey });
    } catch {
      // Upstream detail is deliberately dropped: it can echo prompt content.
      return apiError(ROUTE, requestId, {
        status: 502,
        code: 'UPSTREAM_ERROR',
        message: 'Gemini goal extraction failed. Retry, or use Skip extraction.',
      });
    }

    const validated = GoalExtractedSchema.safeParse(extracted);
    if (!validated.success) {
      return apiError(ROUTE, requestId, {
        status: 422,
        code: 'INVALID_INPUT',
        message: 'Gemini returned a goal that does not match the expected structure.',
      });
    }

    return NextResponse.json({ success: true, ...validated.data });
  } catch {
    return apiError(ROUTE, requestId, {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Failed to extract goal.',
    });
  }
}