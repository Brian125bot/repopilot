import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { validateGitHubToken } from '@/lib/github';
import {
  parseRequestBody,
  parseQueryParams,
  GithubStatusBodySchema,
  GithubStatusQuerySchema,
} from '@/lib/validation';

export async function GET(req: NextRequest) {
  const requestId = createRequestId();
  const queryValidation = parseQueryParams(GithubStatusQuerySchema, req, '/api/github/status', requestId);
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
    return apiError('/api/github/status', requestId, { status: 500, code: 'UPSTREAM_ERROR', message: 'Failed to check GitHub status', details: { status: 'error', isValid: false, checkedAt: new Date().toISOString() } });
  }
}

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  const bodyValidation = await parseRequestBody(GithubStatusBodySchema, req, '/api/github/status', requestId);
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
    return apiError('/api/github/status', requestId, { status: 500, code: 'UPSTREAM_ERROR', message: 'Failed to check GitHub status', details: { status: 'error', isValid: false, checkedAt: new Date().toISOString() } });
  }
}
