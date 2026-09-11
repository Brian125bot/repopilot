import { NextRequest, NextResponse } from 'next/server';
import { validateGitHubToken } from '@/lib/github';

export async function GET(req: NextRequest) {
  try {
    const clientPat = req.headers.get('x-github-pat')?.trim();
    const serverPat = process.env.GITHUB_PAT?.trim();

    const token = clientPat || serverPat;
    const isServerToken = !clientPat && Boolean(serverPat);

    const result = await validateGitHubToken(token);
    if (isServerToken && result.status === 'valid') {
      result.source = 'server';
    } else if (clientPat && result.status === 'valid') {
      result.source = 'user';
    }

    return NextResponse.json(result);
  } catch (error) {
    const err = error as Error;
    return NextResponse.json(
      {
        status: 'error',
        isValid: false,
        error: err.message || 'Failed to check GitHub status',
        checkedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const clientPat = (body.pat || req.headers.get('x-github-pat'))?.trim();
    const serverPat = process.env.GITHUB_PAT?.trim();

    const token = clientPat || serverPat;
    const isServerToken = !clientPat && Boolean(serverPat);

    const result = await validateGitHubToken(token);
    if (isServerToken && result.status === 'valid') {
      result.source = 'server';
    } else if (clientPat && result.status === 'valid') {
      result.source = 'user';
    }

    return NextResponse.json(result);
  } catch (error) {
    const err = error as Error;
    return NextResponse.json(
      {
        status: 'error',
        isValid: false,
        error: err.message || 'Failed to check GitHub status',
        checkedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
