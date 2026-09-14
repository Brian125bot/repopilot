import { NextRequest, NextResponse } from 'next/server';
import { sendJulesMessage, sanitizeJulesCredential } from '@/lib/jules';
import { logRouteError } from '@/lib/safe-log';
import { parseRequestBody, JulesMessageBodySchema } from '@/lib/validation';

/**
 * Sends a follow-up message to an existing Jules session.
 * Follow-ups only: this route never creates a session and never sets
 * automationMode. Fail-closed on missing key, id, or prompt.
 */
export async function POST(req: NextRequest) {
  try {
    const headerJulesKey = req.headers.get('x-jules-api-key');
    const julesApiKey =
      sanitizeJulesCredential(headerJulesKey || '') ||
      sanitizeJulesCredential(process.env.JULES_API_KEY || '');

    if (!julesApiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            'No Google Jules API key configured. Provide an API key via request headers or environment variables.',
        },
        { status: 401 }
      );
    }

    const bodyValidation = await parseRequestBody(JulesMessageBodySchema, req);
    if (!bodyValidation.success) return bodyValidation.response;

    const { sessionId, prompt } = bodyValidation.data;

    const result = await sendJulesMessage({ apiKey: julesApiKey, sessionId, prompt });

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || `Google Jules API error (HTTP ${result.status})`,
          status: result.status,
          details: result.details,
        },
        { status: result.status || 502 }
      );
    }

    return NextResponse.json({
      success: true,
      sessionId: result.sessionId,
      sessionUrl: result.sessionUrl,
      state: result.state,
    });
  } catch (error) {
    logRouteError('/api/jules/message', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown message error.',
      },
      { status: 500 }
    );
  }
}
