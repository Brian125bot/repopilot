import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { sendJulesMessage, sanitizeJulesCredential } from '@/lib/jules';
import { parseRequestBody, JulesMessageBodySchema } from '@/lib/validation';
import { verifyAuditedHead } from '@/lib/audited-head';

/**
 * Sends a follow-up message to an existing Jules session.
 * Follow-ups only: this route never creates a session and never sets
 * automationMode. Fail-closed on missing key, id, or prompt.
 */
export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  try {
    const headerJulesKey = req.headers.get('x-jules-api-key');
    const julesApiKey =
      sanitizeJulesCredential(headerJulesKey || '') ||
      sanitizeJulesCredential(process.env.JULES_API_KEY || '');

    if (!julesApiKey) {
      return apiError('/api/jules/message', requestId, { status: 401, code: 'UNAUTHORIZED', message: 'No Google Jules API key configured. Provide an API key via request headers or environment variables.' });
    }

    const bodyValidation = await parseRequestBody(JulesMessageBodySchema, req, '/api/jules/message', requestId);
    if (!bodyValidation.success) return bodyValidation.response;

    const { sessionId, prompt, isRemediation, prUrl, auditedHeadSha } = bodyValidation.data;

    if (isRemediation) {
      const headCheck = await verifyAuditedHead({
        prUrl,
        auditedHeadSha: auditedHeadSha || '',
        githubPat: req.headers.get('x-github-pat'),
      });
      if (!headCheck.ok) {
        return apiError('/api/jules/message', requestId, {
          status: headCheck.status,
          code: 'INVALID_INPUT',
          message: headCheck.error,
        });
      }
    }

    const result = await sendJulesMessage({ apiKey: julesApiKey, sessionId, prompt });

    if (!result.ok) {
      return apiError('/api/jules/message', requestId, { status: result.status || 502, code: 'UPSTREAM_ERROR', message: result.error || `Google Jules API error (HTTP ${result.status})`, details: { status: result.status } });
    }

    return NextResponse.json({
      success: true,
      sessionId: result.sessionId,
      sessionUrl: result.sessionUrl,
      state: result.state,
    });
  } catch (error) {
    return apiError('/api/jules/message', requestId, { status: 500, code: 'INTERNAL_ERROR', message: 'Unknown message error.' });
  }
}
