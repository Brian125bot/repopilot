import { NextRequest, NextResponse } from 'next/server';
import { sendJulesMessage } from '@/lib/jules';

interface MessageRequestBody {
  sessionId?: string;
  prompt?: string;
}

/**
 * Sends a follow-up message to an existing Jules session.
 * Follow-ups only: this route never creates a session and never sets
 * automationMode. Fail-closed on missing key, id, or prompt.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as MessageRequestBody;
    const sessionId = body.sessionId?.trim() || '';
    const prompt = body.prompt?.trim() || '';

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
        { success: false, error: 'Session ID is required. Provide sessionId.' },
        { status: 400 }
      );
    }

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: 'Prompt is required. Provide prompt.' },
        { status: 400 }
      );
    }

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
    console.error('Error in /api/jules/message:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown message error.',
      },
      { status: 500 }
    );
  }
}
