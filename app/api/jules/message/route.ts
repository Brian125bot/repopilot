import { NextRequest, NextResponse } from 'next/server';
import { sendJulesMessage, sanitizeJulesCredential } from '@/lib/jules';
import { logRouteError, logger, getRequestId } from '@/lib/safe-log';
import { parseRequestBody, JulesMessageBodySchema } from '@/lib/validation';

/**
 * Sends a follow-up message to an existing Jules session.
 * Follow-ups only: this route never creates a session and never sets
 * automationMode. Fail-closed on missing key, id, or prompt.
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  const start = performance.now();
  logger.info('Request entry', { route: '/api/jules/message', method: 'POST', requestId });
  try {
    const headerJulesKey = req.headers.get('x-jules-api-key');
    const julesApiKey =
      sanitizeJulesCredential(headerJulesKey || '') ||
      sanitizeJulesCredential(process.env.JULES_API_KEY || '');

    if (!julesApiKey) {
      logger.info('Request complete', { route: '/api/jules/message', method: 'POST', requestId, status: 401, latency: performance.now() - start });
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
      logger.info('Request complete', { route: '/api/jules/message', method: 'POST', requestId, status: result.status || 502, latency: performance.now() - start });
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

    logger.info('Request complete', { route: '/api/jules/message', method: 'POST', requestId, status: 200, latency: performance.now() - start });
    return NextResponse.json({
      success: true,
      sessionId: result.sessionId,
      sessionUrl: result.sessionUrl,
      state: result.state,
    });
  } catch (error) {
    logRouteError('/api/jules/message', error);
    logger.info('Request complete', { route: '/api/jules/message', method: 'POST', requestId, status: 500, latency: performance.now() - start });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown message error.',
      },
      { status: 500 }
    );
  }
}