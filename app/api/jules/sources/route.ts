import { NextRequest, NextResponse } from 'next/server';
import { listJulesSources, sanitizeJulesCredential } from '@/lib/jules';

export async function GET(req: NextRequest) {
  try {
    const headerJulesKey = req.headers.get('x-jules-api-key');
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

    // Paginated via lib so workspaces past the first API page still list fully.
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

    return NextResponse.json({
      configured: true,
      valid: false,
      hasServerKey: Boolean(process.env.JULES_API_KEY),
      error: listed.error || `HTTP ${listed.status}`,
      status: listed.status,
    });
  } catch (err) {
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
