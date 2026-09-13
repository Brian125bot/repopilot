import { NextRequest, NextResponse } from 'next/server';
import { getJulesSession, sanitizeJulesCredential } from '@/lib/jules';
import { resolveDriver } from '@/lib/blueprint-vault-driver';
import { logRouteError } from '@/lib/safe-log';

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get('id')?.trim() || '';

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

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Session ID is required. Provide ?id=sessions/xxx.' },
        { status: 400 }
      );
    }

    const snapshot = await getJulesSession(julesApiKey, sessionId);

    if (!snapshot.ok) {
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

    // Durable harvest recovery: when the session opened a PR and the caller
    // identifies the blueprint, patch the server vault record so a later
    // device or reload resumes at Stage 2. Best-effort — never fails the read.
    // A repo mismatch aborts the patch (never attach a PR to the wrong record).
    const blueprintId = req.nextUrl.searchParams.get('blueprintId')?.trim() || '';
    const repoScope = req.nextUrl.searchParams.get('repo')?.trim() || '';
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
    logRouteError('/api/jules/session', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown session read error.',
      },
      { status: 500 }
    );
  }
}
