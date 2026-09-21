import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { extractGoalFromText } from '@/lib/gemini';
import { logRouteError } from '@/lib/safe-log';
import {
  GoalExtractBodySchema,
  GoalExtractedSchema,
  parseRequestBody,
} from '@/lib/validation';

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  const route = '/api/goal/extract';

  try {
    const bodyValidation = await parseRequestBody(GoalExtractBodySchema, req, route, requestId);
    if (!bodyValidation.success) return bodyValidation.response;

    const { rawText } = bodyValidation.data;
    const customApiKey = req.headers.get('x-gemini-api-key') || undefined;

    const extracted = await extractGoalFromText({ rawText, customApiKey });

    const validatedResult = GoalExtractedSchema.safeParse(extracted);
    if (!validatedResult.success) {
      logRouteError(route, { requestId, status: 422, code: 'INVALID_INPUT' });
      return apiError(route, requestId, {
        status: 422,
        code: 'INVALID_INPUT',
        message: 'Gemini goal extraction produced an unprocessable schema.',
      });
    }

    return NextResponse.json(validatedResult.data);
  } catch (error: unknown) {
    logRouteError(route, { requestId, status: 500, code: 'INTERNAL_ERROR' });
    return apiError(route, requestId, {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Failed to extract goal via Gemini.',
    });
  }
}
