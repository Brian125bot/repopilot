import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { getJulesSession, sanitizeJulesCredential } from '@/lib/jules';
import { resolveDriver } from '@/lib/blueprint-vault-driver';
import { parseQueryParams, JulesSessionQuerySchema } from '@/lib/validation';

export async function GET(req: NextRequest) {
  const requestId = createRequestId();
  try {
    const headerJulesKey = req?.headers.get('x-jules-api-key');
    const julesApiKey =
      sanitizeJulesCredential(headerJulesKey || '') ||
      sanitizeJulesCredential(process.env.JULES_API_KEY || '');

    if (!julesApiKey) {
      return apiError('/api/jules/session', requestId, { status: 401, code: 'UNAUTHORIZED', message: 'No Google Jules API key configured. Provide an API key via request headers or environment variables.' });
    }

    const queryValidation = parseQueryParams(JulesSessionQuerySchema, req, '/api/jules/session', requestId);
    if (!queryValidation.success) return queryValidation.response;

    const { id: sessionId, blueprintId = '', repo: repoScope = '' } = queryValidation.data;

    const snapshot = await getJulesSession(julesApiKey, sessionId);

    if (!snapshot.ok) {
      return apiError('/api/jules/session', requestId, { status: snapshot.status || 502, code: 'UPSTREAM_ERROR', message: snapshot.error || `Google Jules API error (HTTP ${snapshot.status})`, details: { status: snapshot.status } });
    }

    if (snapshot.prUrl && blueprintId) {
      try {
        const driver = resolveDriver();
        const record = await driver.get(blueprintId);
        if (record && (!repoScope || record.repo === repoScope)) {
          await driver.upsert({
            ...record,
            prUrl: snapshot.prUrl,
            prTitle: snapshot.prTitle || record.prTitle,
            sessionState: 'COMPLETED',
            sessionId: snapshot.sessionId || record.sessionId,
            sessionUrl: snapshot.sessionUrl || record.sessionUrl,
          });
        }
      } catch {
        // Vault write is advisory; the snapshot below carries the harvest.
      }
    }

    return NextResponse.json({
      success: true,
      sessionId: snapshot.sessionId,
      sessionUrl: snapshot.sessionUrl,
      state: snapshot.state,
      prUrl: snapshot.prUrl,
      prTitle: snapshot.prTitle,
      data: snapshot.data,
    });
  } catch (error) {
    return apiError('/api/jules/session', requestId, { status: 500, code: 'INTERNAL_ERROR', message: 'Unknown session read error.' });
  }
}
