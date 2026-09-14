/**
 * Route error logger. Its fixed allowlist prevents credentials, prompts, diffs,
 * request headers, and arbitrary upstream error text from reaching route logs.
 */
export function logRouteError(
  route: string,
  context: { requestId: string; status: number; code: string }
): void {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'api_request_failed',
      route,
      requestId: context.requestId,
      status: context.status,
      code: context.code,
    })
  );
}
