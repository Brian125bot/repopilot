import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { findJulesSource, sanitizeJulesCredential } from '@/lib/jules';
import { redactSecrets } from '@/lib/redact-secrets';
import {
  fetchWithVerifyTimeout,
  isVerifyTimeout,
  resolveVerifyKey,
  unmappedProviderMessage,
  VERIFY_TIMEOUT_MESSAGE,
} from '@/lib/settings-verify';
import { julesNotConnectedMessage } from '@/lib/settings-verify-messages';

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  const route = '/api/settings/verify-jules';
  try {
    const rawKey = resolveVerifyKey(
      req.headers.get('x-jules-api-key'),
      process.env.JULES_API_KEY,
      route,
      requestId
    );
    const key = sanitizeJulesCredential(rawKey);
    if (!key) {
      return apiError(route, requestId, {
        status: 401,
        code: 'UNAUTHORIZED',
        message: "This Jules key isn't authorized. Generate one in Jules settings.",
      });
    }

    let repo = '';
    try {
      const body = (await req.json()) as { repo?: unknown };
      if (typeof body?.repo === 'string') repo = body.repo.trim();
    } catch {
      repo = '';
    }

    let res: Response;
    try {
      res = await fetchWithVerifyTimeout(
        'https://jules.googleapis.com/v1alpha/sources?pageSize=50',
        {
          headers: {
            'x-goog-api-key': key,
            'User-Agent': 'RepoPilot-Settings',
          },
        }
      );
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

    if (res.status === 401 || res.status === 403) {
      return apiError(route, requestId, {
        status: res.status,
        code: 'UPSTREAM_ERROR',
        message: "This Jules key isn't authorized. Generate one in Jules settings.",
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
      sources?: Array<{ name?: string; id?: string }>;
    };
    const sources = Array.isArray(data.sources)
      ? data.sources
          .filter((s) => typeof s?.name === 'string' && s.name)
          .map((s) => ({ name: s.name as string, id: typeof s.id === 'string' ? s.id : '' }))
      : [];

    if (!repo) {
      return NextResponse.json({ success: true, ok: true, sources, requestId });
    }

    const connected = findJulesSource(
      sources.map((s) => ({ name: s.name, id: s.id || undefined })),
      repo
    );
    const targetRepoConnected = connected !== null;
    const payload: Record<string, unknown> = {
      success: true,
      ok: true,
      sources,
      targetRepoConnected,
      requestId,
    };
    if (!targetRepoConnected) {
      payload.notConnectedNotice = julesNotConnectedMessage(repo);
    }
    return NextResponse.json(payload);
  } catch (error) {
    console.error(JSON.stringify({ event: 'verify_failed', route, requestId, detail: redactSecrets(error instanceof Error ? error.message : 'unknown') }));
    return apiError(route, requestId, {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Provider responded with 500. Try again, or re-check the key.',
    });
  }
}
