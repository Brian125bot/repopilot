import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const headerJulesKey = req.headers.get('x-jules-api-key');
    const julesApiKey = headerJulesKey?.trim() || process.env.JULES_API_KEY?.trim();

    if (!julesApiKey) {
      return NextResponse.json({
        configured: false,
        valid: false,
        hasServerKey: Boolean(process.env.JULES_API_KEY),
        message: 'No Google Jules API key provided.',
      });
    }

    // Ping Jules API to list sources and test credentials
    const julesSourcesEndpoint = 'https://jules.googleapis.com/v1alpha/sources';
    const response = await fetch(julesSourcesEndpoint, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': julesApiKey,
        'User-Agent': 'RepoPilot/1.0',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({
        configured: true,
        valid: true,
        hasServerKey: Boolean(process.env.JULES_API_KEY),
        sources: data.sources || [],
      });
    }

    let errorDetail = `HTTP ${response.status}`;
    try {
      const errorJson = await response.json();
      if (errorJson.error?.message) {
        errorDetail = errorJson.error.message;
      }
    } catch {
      const text = await response.text().catch(() => '');
      if (text) errorDetail = text.slice(0, 200);
    }

    return NextResponse.json({
      configured: true,
      valid: false,
      hasServerKey: Boolean(process.env.JULES_API_KEY),
      error: errorDetail,
      status: response.status,
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
