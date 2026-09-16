export const VERIFY_TIMEOUT_MS = 5000;

export const VERIFY_TIMEOUT_MESSAGE = "Provider didn't respond in 5s — try again.";

export class VerifyTimeoutError extends Error {
  constructor() {
    super(VERIFY_TIMEOUT_MESSAGE);
    this.name = 'VerifyTimeoutError';
  }
}

export function isVerifyTimeout(error: unknown): boolean {
  return (
    error instanceof VerifyTimeoutError ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export async function fetchWithVerifyTimeout(
  url: string,
  init: RequestInit = {},
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = VERIFY_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new VerifyTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function resolveVerifyKey(
  headerValue: string | null | undefined,
  envValue: string | null | undefined,
  route: string,
  requestId: string
): string {
  const headerKey = (headerValue || '').trim();
  if (headerKey) return headerKey;
  const envKey = (envValue || '').trim();
  if (envKey) {
    console.log(JSON.stringify({ event: 'verify_server_fallback', route, requestId }));
    return envKey;
  }
  return '';
}

export function unmappedProviderMessage(status: number): string {
  return `Provider responded with ${status}. Try again, or re-check the key.`;
}
