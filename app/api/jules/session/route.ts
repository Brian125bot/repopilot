import { NextRequest, NextResponse } from 'next/server';
import { getJulesSession } from '@/lib/jules';

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get('id')?.trim() || '';

    const headerJulesKey = req.headers.get('x-jules-api-key');
    const julesApiKey = headerJulesKey?.trim() || process.env.JULES_API_KEY?.trim();

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
    console.error('Error in /api/jules/session:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown session read error.',
      },
      { status: 500 }
    );
  }
}
