import { NextRequest, NextResponse } from 'next/server';
import { Type } from '@google/genai';
import { apiError, createRequestId } from '@/lib/api-error';
import { getGeminiClient } from '@/lib/gemini';
import { GoalExtractBodySchema, parseRequestBody } from '@/lib/validation';
import { buildGoalExtractionPrompt } from '@/lib/goals/extract-prompt';
import { GoalExtractedSchema } from '@/lib/goals/types';
import { logRouteError } from '@/lib/safe-log';

const goalExtractionResponseSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Short summary title or "UNCLEAR" if ambiguous' },
    scope: { type: Type.STRING, description: 'Expected file boundaries or modules to modify' },
    acceptanceCriteria: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Verifiable acceptance criteria statements',
    },
    assumptions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Key technical assumptions',
    },
    ambiguityFlags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Ambiguities, risks, or missing information requiring operator review',
    },
  },
  required: ['title', 'scope', 'acceptanceCriteria', 'assumptions', 'ambiguityFlags'],
};

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  const route = '/api/goal/extract';

  try {
    const bodyValidation = await parseRequestBody(GoalExtractBodySchema, req, route, requestId);
    if (!bodyValidation.success) return bodyValidation.response;

    const { rawText, repoProfile } = bodyValidation.data;

    const geminiApiKey = req.headers.get('x-gemini-api-key') || process.env.GEMINI_API_KEY || '';
    if (!geminiApiKey.trim()) {
      logRouteError(route, { requestId, status: 401, code: 'UNAUTHORIZED' });
      return apiError(route, requestId, {
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Gemini API key is required in request header (x-gemini-api-key).',
      });
    }

    const ai = getGeminiClient(geminiApiKey);
    const prompt = buildGoalExtractionPrompt(rawText, repoProfile);

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: 'You are an expert software engineering lead extracting structured task goals.',
        responseMimeType: 'application/json',
        responseSchema: goalExtractionResponseSchema,
        temperature: 0.1,
      },
    });

    const responseText = response.text;
    if (!responseText) {
      logRouteError(route, { requestId, status: 502, code: 'UPSTREAM_ERROR' });
      return apiError(route, requestId, {
        status: 502,
        code: 'UPSTREAM_ERROR',
        message: 'Gemini API returned an empty extraction response.',
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(responseText);
    } catch {
      logRouteError(route, { requestId, status: 502, code: 'UPSTREAM_ERROR' });
      return apiError(route, requestId, {
        status: 502,
        code: 'UPSTREAM_ERROR',
        message: 'Failed to parse JSON response from Gemini.',
      });
    }

    const validation = GoalExtractedSchema.safeParse(parsedJson);
    if (!validation.success) {
      logRouteError(route, { requestId, status: 502, code: 'UPSTREAM_ERROR' });
      return apiError(route, requestId, {
        status: 502,
        code: 'UPSTREAM_ERROR',
        message: 'Extracted goal schema validation failed.',
      });
    }

    return NextResponse.json({
      success: true,
      extracted: validation.data,
    });
  } catch (err) {
    logRouteError(route, { requestId, status: 500, code: 'INTERNAL_ERROR' });
    return apiError(route, requestId, {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: err instanceof Error ? err.message : 'Internal error during goal extraction.',
    });
  }
}
