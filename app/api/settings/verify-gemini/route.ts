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
import { GEMINI_EMPTY_MODELS_MESSAGE } from '@/lib/settings-verify-messages';

const MAX_SAMPLE_MODELS = 10;

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  const route = '/api/settings/verify-gemini';
  try {
    const key = resolveVerifyKey(
      req.headers.get('x-gemini-api-key') || req.headers.get('x-gemini-key'),
      process.env.GEMINI_API_KEY,
      route,
      requestId
    );
    if (!key) {
      return apiError(route, requestId, {
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'This Gemini key is invalid. Generate a new one in Google AI Studio.',
      });
    }

    let res: Response;
    try {
      res = await fetchWithVerifyTimeout(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=10',
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

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      const redacted = redactSecrets(bodyText);
      if (res.status === 400 && redacted.includes('API_KEY_INVALID')) {
        return apiError(route, requestId, {
          status: 400,
          code: 'UPSTREAM_ERROR',
          message: 'This Gemini key is invalid. Generate a new one in Google AI Studio.',
        });
      }
      if (res.status === 403) {
        return apiError(route, requestId, {
          status: 403,
          code: 'UPSTREAM_ERROR',
          message: "This Gemini key isn't permitted to call the Generative Language API.",
        });
      }
      return apiError(route, requestId, {
        status: res.status,
        code: 'UPSTREAM_ERROR',
        message: unmappedProviderMessage(res.status),
      });
    }

    const data = (await res.json().catch(() => ({}))) as {
      models?: Array<{ name?: string }>;
    };
    const sampleModels = Array.isArray(data.models)
      ? data.models
          .map((m) => (typeof m?.name === 'string' ? m.name : ''))
          .filter(Boolean)
          .slice(0, MAX_SAMPLE_MODELS)
      : [];

    return NextResponse.json({
      success: true,
      ok: true,
      sampleModels,
      emptyModelsNotice: sampleModels.length === 0 ? GEMINI_EMPTY_MODELS_MESSAGE : undefined,
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
