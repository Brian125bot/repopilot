import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { redactSecrets } from '@/lib/redact-secrets';
import {
  fetchWithVerifyTimeout,
  isVerifyTimeout,
  resolveVerifyKey,
  unmappedProviderMessage,
  VERIFY_TIMEOUT_MESSAGE,
} from '@/lib/settings-verify';
import {
  FINE_GRAINED_ACCESS_WARNING,
  classifyGitHubToken,
  classicScopeWarnings,
} from '@/lib/settings-verify-messages';

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  const route = '/api/settings/verify-github';
  try {
    const key = resolveVerifyKey(
      req.headers.get('x-github-pat'),
      process.env.GITHUB_PAT,
      route,
      requestId
    );
    if (!key) {
      return apiError(route, requestId, {
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'GitHub rejected this token. It may be expired, revoked, or mistyped.',
      });
    }

    let res: Response;
    try {
      res = await fetchWithVerifyTimeout('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'RepoPilot-Settings',
        },
      });
    } catch (error) {
      if (isVerifyTimeout(error)) {
        return apiError(route, requestId, {
          status: 504,
          code: 'TIMEOUT',
          message: VERIFY_TIMEOUT_MESSAGE,
        });
      }
      return apiError(route, requestId, {
        status: 502,
        code: 'UPSTREAM_ERROR',
        message: 'Provider responded with 502. Try again, or re-check the key.',
      });
    }

    if (res.status === 401) {
      return apiError(route, requestId, {
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'GitHub rejected this token. It may be expired, revoked, or mistyped.',
      });
    }
    if (res.status === 403) {
      const rateRemaining = res.headers.get('x-ratelimit-remaining');
      if (rateRemaining === '0') {
        return apiError(route, requestId, {
          status: 403,
          code: 'UPSTREAM_ERROR',
          message: 'GitHub rate limit hit. Wait a few minutes or use a different token.',
        });
      }
      return apiError(route, requestId, {
        status: 403,
        code: 'UPSTREAM_ERROR',
        message: FINE_GRAINED_ACCESS_WARNING,
      });
    }
    if (res.status === 404) {
      return apiError(route, requestId, {
        status: 404,
        code: 'UPSTREAM_ERROR',
        message: FINE_GRAINED_ACCESS_WARNING,
      });
    }
    if (!res.ok) {
      return apiError(route, requestId, {
        status: res.status,
        code: 'UPSTREAM_ERROR',
        message: unmappedProviderMessage(res.status),
      });
    }

    const data = (await res.json().catch(() => ({}))) as {
      login?: string;
      name?: string;
    };
    const { tokenType, scopes } = classifyGitHubToken(
      res.headers.get('x-oauth-scopes'),
      res.headers.get('x-github-token-type')
    );
    const warnings = tokenType === 'classic' ? classicScopeWarnings(scopes) : [];

    return NextResponse.json({
      success: true,
      ok: true,
      login: data.login || '',
      name: data.name || '',
      scopes,
      tokenType,
      warnings,
      requestId,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'verify_failed', route, requestId, detail: redactSecrets(error instanceof Error ? error.message : 'unknown') }));
    return apiError(route, requestId, {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Provider responded with 500. Try again, or re-check the key.',
    });
  }
}
