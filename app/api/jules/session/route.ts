import { NextRequest, NextResponse } from 'next/server';
import { getJulesSession, sanitizeJulesCredential } from '@/lib/jules';
import { resolveDriver } from '@/lib/blueprint-vault-driver';
import { logRouteError, logger, getRequestId } from '@/lib/safe-log';
import { parseQueryParams, JulesSessionQuerySchema } from '@/lib/validation';

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req);
  const start = performance.now();
  logger.info('Request entry', { route: '/api/jules/session', method: 'GET', requestId });
  try {
    const headerJulesKey = req?.headers.get('x-jules-api-key');
    const julesApiKey =
      sanitizeJulesCredential(headerJulesKey || '') ||
      sanitizeJulesCredential(process.env.JULES_API_KEY || '');

    if (!julesApiKey) {
      logger.info('Request complete', { route: '/api/jules/session', method: 'GET', requestId, status: 401, latency: performance.now() - start });
      return NextResponse.json(
        {
          success: false,
          error:
            'No Google Jules API key configured. Provide an API key via request headers or environment variables.',
        },
        { status: 401 }
      );
    }

    const queryValidation = parseQueryParams(JulesSessionQuerySchema, req);
    if (!queryValidation.success) return queryValidation.response;

    const { id: sessionId, blueprintId = '', repo: repoScope = '' } = queryValidation.data;

    const snapshot = await getJulesSession(julesApiKey, sessionId);

    if (!snapshot.ok) {
      logger.info('Request complete', { route: '/api/jules/session', method: 'GET', requestId, status: snapshot.status || 502, latency: performance.now() - start });
      return NextResponse.json(
        {
          success: false,
          error: snapshot.error || `Google Jules API error (HTTP ${snapshot.status})`,
          status: snapshot.status,
          details: snapshot.details,
        },
        { status: snapshot.status || 502 }
      );
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

    logger.info('Request complete', { route: '/api/jules/session', method: 'GET', requestId, status: 200, latency: performance.now() - start });
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
    logRouteError('/api/jules/session', error);
    logger.info('Request complete', { route: '/api/jules/session', method: 'GET', requestId, status: 500, latency: performance.now() - start });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown session read error.',
      },
      { status: 500 }
    );
  }
}