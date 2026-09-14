import { NextRequest, NextResponse } from 'next/server';
import { logger, getRequestId, logRouteError } from '@/lib/safe-log';
import { listJulesSources, sanitizeJulesCredential } from '@/lib/jules';
import { parseQueryParams, JulesSourcesQuerySchema } from '@/lib/validation';

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req);
  const start = performance.now();
  logger.info('Request entry', { route: '/api/jules/sources', method: 'GET', requestId });
  const queryValidation = parseQueryParams(JulesSourcesQuerySchema, req);
  if (!queryValidation.success) return queryValidation.response;

  try {
    const headerJulesKey = req?.headers.get('x-jules-api-key');
    const julesApiKey =
      sanitizeJulesCredential(headerJulesKey || '') ||
      sanitizeJulesCredential(process.env.JULES_API_KEY || '');

    if (!julesApiKey) {
      logger.info('Request complete', { route: '/api/jules/sources', method: 'GET', requestId, status: 200, latency: performance.now() - start });
      return NextResponse.json({
        configured: false,
        valid: false,
        hasServerKey: Boolean(process.env.JULES_API_KEY),
        message: 'No Google Jules API key provided.',
      });
    }

    const listed = await listJulesSources(julesApiKey);

    if (listed.ok) {
      logger.info('Request complete', { route: '/api/jules/sources', method: 'GET', requestId, status: 200, latency: performance.now() - start });
      return NextResponse.json({
        configured: true,
        valid: true,
        hasServerKey: Boolean(process.env.JULES_API_KEY),
        sources: listed.sources,
        truncated: listed.truncated,
      });
    }

    logger.info('Request complete', { route: '/api/jules/sources', method: 'GET', requestId, status: 200, latency: performance.now() - start });
    return NextResponse.json({
      configured: true,
      valid: false,
      hasServerKey: Boolean(process.env.JULES_API_KEY),
      error: listed.error || `HTTP ${listed.status}`,
      status: listed.status,
    });
  } catch (err) {
    logRouteError('/api/jules/sources', err);
    logger.info('Request complete', { route: '/api/jules/sources', method: 'GET', requestId, status: 500, latency: performance.now() - start });
    return NextResponse.json(
      {
        configured: true,
        valid: false,
        error: err instanceof Error ? err.message : 'Network error testing Jules API key',
      },
      { status: 500 }
    );
  }
}