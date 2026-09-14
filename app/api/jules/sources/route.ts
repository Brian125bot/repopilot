import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { listJulesSources, sanitizeJulesCredential } from '@/lib/jules';
import { parseQueryParams, JulesSourcesQuerySchema } from '@/lib/validation';

export async function GET(req: NextRequest) {
  const requestId = createRequestId();
  const queryValidation = parseQueryParams(JulesSourcesQuerySchema, req, '/api/jules/sources', requestId);
  if (!queryValidation.success) return queryValidation.response;

  try {
    const headerJulesKey = req?.headers.get('x-jules-api-key');
    const julesApiKey =
      sanitizeJulesCredential(headerJulesKey || '') ||
      sanitizeJulesCredential(process.env.JULES_API_KEY || '');

    if (!julesApiKey) {
      return NextResponse.json({
        configured: false,
        valid: false,
        hasServerKey: Boolean(process.env.JULES_API_KEY),
        message: 'No Google Jules API key provided.',
      });
    }

    const listed = await listJulesSources(julesApiKey);

    if (listed.ok) {
      return NextResponse.json({
        configured: true,
        valid: true,
        hasServerKey: Boolean(process.env.JULES_API_KEY),
        sources: listed.sources,
        truncated: listed.truncated,
      });
    }

    return apiError('/api/jules/sources', requestId, { status: listed.status || 502, code: 'UPSTREAM_ERROR', message: listed.error || `HTTP ${listed.status}`, details: { configured: true, valid: false, hasServerKey: Boolean(process.env.JULES_API_KEY), status: listed.status } });
  } catch (err) {
    return apiError('/api/jules/sources', requestId, { status: 500, code: 'UPSTREAM_ERROR', message: 'Network error testing Jules API key', details: { configured: true, valid: false } });
  }
}
