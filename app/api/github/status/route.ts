import { NextRequest, NextResponse } from 'next/server';
import { validateGitHubToken } from '@/lib/github';
import {
  parseRequestBody,
  parseQueryParams,
  GithubStatusBodySchema,
  GithubStatusQuerySchema,
} from '@/lib/validation';

export async function GET(req: NextRequest) {
  const queryValidation = parseQueryParams(GithubStatusQuerySchema, req);
  if (!queryValidation.success) return queryValidation.response;

  try {
    const clientPat = req?.headers.get('x-github-pat')?.trim();
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
  const bodyValidation = await parseRequestBody(GithubStatusBodySchema, req);
  if (!bodyValidation.success) return bodyValidation.response;

  try {
    const body = bodyValidation.data || {};
    const clientPat = (body.pat || req?.headers.get('x-github-pat'))?.trim();
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
